import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AdminPermissions, AdminRole, AdminUser } from '../src/types/school.ts';

const SESSION_COOKIE_NAME = 'al_muntadhar_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 1000 * 60 * 10; // 10 minutes

const runtimeSessionSecret =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

export function hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return { hash: derived.toString('hex'), salt };
}

export function verifyPassword(password: string, expectedHash: string, salt: string): boolean {
  const { hash } = hashPassword(password, salt);
  const bufA = Buffer.from(hash, 'hex');
  const bufB = Buffer.from(expectedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

interface SessionPayload {
  uid: number;
  username: string;
  role: AdminRole;
  exp: number;
}

export function createSessionToken(user: { id: number; username: string; role: AdminRole }): string {
  const payload: SessionPayload = {
    uid: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', runtimeSessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', runtimeSessionSecret)
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.uid || !parsed.exp || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function isHttpsRequest(req: Request): boolean {
  const xfProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(xfProto) ? xfProto[0] : xfProto;
  return Boolean(
    req.secure ||
      (proto && proto.split(',')[0].trim().toLowerCase() === 'https') ||
      (process.env.APP_URL && process.env.APP_URL.startsWith('https://'))
  );
}

export function extractSessionToken(req: Request): string | undefined {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  return undefined;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = isHttpsRequest(req);

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = isHttpsRequest(req);

  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    path: '/',
  });
}

// Brute-force login rate limiter keyed by client IP + normalized username
const attemptMap = new Map<string, { count: number; lockedUntil: number; firstAttemptAt: number }>();

function rateLimitKey(req: Request, username: string): string {
  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.ip) || 'local';
  return `${ip}::${username.trim().toLowerCase()}`;
}

export function checkLoginRateLimit(
  req: Request,
  username: string
): { allowed: boolean; retryAfterSeconds?: number } {
  const key = rateLimitKey(req, username);
  const record = attemptMap.get(key);
  if (!record) return { allowed: true };

  const now = Date.now();
  if (record.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000),
    };
  }

  if (now - record.firstAttemptAt > LOCKOUT_WINDOW_MS) {
    attemptMap.delete(key);
  }
  return { allowed: true };
}

export function recordFailedLogin(req: Request, username: string): { locked: boolean; remaining: number } {
  const key = rateLimitKey(req, username);
  const now = Date.now();
  const existing = attemptMap.get(key);

  if (!existing || now - existing.firstAttemptAt > LOCKOUT_WINDOW_MS) {
    attemptMap.set(key, { count: 1, lockedUntil: 0, firstAttemptAt: now });
    return { locked: false, remaining: MAX_LOGIN_ATTEMPTS - 1 };
  }

  existing.count += 1;
  if (existing.count >= MAX_LOGIN_ATTEMPTS) {
    existing.lockedUntil = now + LOCKOUT_WINDOW_MS;
    return { locked: true, remaining: 0 };
  }
  return { locked: false, remaining: MAX_LOGIN_ATTEMPTS - existing.count };
}

export function clearLoginRateLimit(req: Request, username: string): void {
  attemptMap.delete(rateLimitKey(req, username));
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export interface AdminRequest extends Request {
  admin?: AdminUser;
}

export function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.headers.origin;
  const host = req.headers.host;
  const forwardedHostRaw = req.headers['x-forwarded-host'];
  const forwardedHost = Array.isArray(forwardedHostRaw)
    ? forwardedHostRaw[0]
    : forwardedHostRaw?.split(',')[0].trim();

  if (origin && (host || forwardedHost)) {
    try {
      const originHost = new URL(origin).host;
      const allowedHosts = new Set<string>();
      if (host) allowedHosts.add(host);
      if (forwardedHost) allowedHosts.add(forwardedHost);
      if (process.env.APP_URL) {
        try {
          allowedHosts.add(new URL(process.env.APP_URL).host);
        } catch {
          // ignore malformed APP_URL
        }
      }
      if (!allowedHosts.has(originHost)) {
        res.status(403).json({ error: 'تم رفض الطلب لأسباب أمنية (عدم تطابق المصدر).' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'مصدر الطلب غير صالح.' });
      return;
    }
  }
  next();
}

export function hasPermission(admin: AdminUser, perm: keyof AdminPermissions): boolean {
  if (admin.role === 'owner') return true;
  return Boolean(admin.permissions?.[perm]);
}
