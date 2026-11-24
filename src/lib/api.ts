const TOKEN_KEY = 'al_muntadhar_admin_token';

export function getAdminSessionToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminSessionToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // ignore storage restriction
  }
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAdminSessionToken();
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.includes('/api/admin/login')) {
    setAdminSessionToken(null);
  }
  if (!res.ok) {
    throw new Error(data?.error || `تعذر إتمام الطلب (رمز ${res.status})`);
  }
  return data as T;
}

export async function downloadBinaryFile(
  url: string,
  fallbackFilename: string,
  options?: RequestInit
): Promise<void> {
  const token = getAdminSessionToken();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      credentials: 'same-origin',
      signal: controller.signal,
      ...options,
      headers: {
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options?.headers ?? {}),
      },
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || `تعذر تنزيل الملف (رمز ${res.status})`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || 'استجابة غير متوقعة أثناء تنزيل الملف.');
    }

    const blob = await res.blob();
    if (blob.size === 0) {
      throw new Error('تم استلام ملف فارغ من الخادم.');
    }
    let filename = fallbackFilename;
    const disp = res.headers.get('content-disposition');
    if (disp) {
      const utf8Match = /filename\*=UTF-8''([^;\n]+)/i.exec(disp);
      const plainMatch = /filename="?([^";\n]+)"?/i.exec(disp);
      if (utf8Match?.[1]) {
        try {
          filename = decodeURIComponent(utf8Match[1].trim());
        } catch {
          filename = utf8Match[1].trim();
        }
      } else if (plainMatch?.[1]) {
        filename = plainMatch[1].trim();
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(objectUrl);
    }, 10000);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('انتهت مهلة التنزيل (30 ثانية). يرجى المحاولة مرة أخرى.');
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function apiDownload(url: string, fallbackFilename: string): Promise<void> {
  return downloadBinaryFile(url, fallbackFilename);
}
