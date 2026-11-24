import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const configWithDb = firebaseConfig as typeof firebaseConfig & {
  firestoreDatabaseId?: string;
};

const app = initializeApp(firebaseConfig);
const databaseId = configWithDb.firestoreDatabaseId || 'ai-studio-9f7eefd9-7087-44d3-93db-f50047e91a33';

export const db = getFirestore(app, databaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('يرجى التحقق من اتصال وإعدادات Firebase.');
    }
  }
}

// In-memory OAuth access token cache (never stored in localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export function initGoogleWorkspaceAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthUnavailable?: () => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (user && cachedAccessToken) {
      onAuthSuccess?.(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      onAuthUnavailable?.();
    }
  });
}

export async function googleWorkspaceSignIn(): Promise<{
  user: User;
  accessToken: string;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('لم يتم الحصول على رمز الوصول إلى Google Sheets.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleWorkspaceToken(): string | null {
  return cachedAccessToken;
}

export const googleGateProvider = new GoogleAuthProvider();
googleGateProvider.setCustomParameters({ prompt: 'select_account' });

export async function googleAdminGateSignIn(): Promise<{
  idToken: string;
  email: string;
  displayName: string;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleGateProvider);
    const idToken = await result.user.getIdToken(true);
    if (!idToken || !result.user.email) {
      throw new Error('تعذر التحقق من حساب Google الخاص بك.');
    }
    return {
      idToken,
      email: result.user.email,
      displayName: result.user.displayName || result.user.email,
    };
  } finally {
    isSigningIn = false;
  }
}

export async function googleWorkspaceSignOut(): Promise<void> {
  await auth.signOut();
  cachedAccessToken = null;
}

export async function googleDriveBackupSignIn(): Promise<{
  user: User;
  accessToken: string;
}> {
  const driveProvider = new GoogleAuthProvider();
  driveProvider.addScope('https://www.googleapis.com/auth/drive.file');
  driveProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, driveProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('لم يتم الحصول على صلاحية الوصول إلى Google Drive.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export async function uploadBackupToGoogleDrive(
  accessToken: string,
  filename: string,
  blob: Blob
): Promise<{ id: string; name: string }> {
  const metadata = {
    name: filename,
    mimeType: blob.type || 'application/octet-stream',
  };
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', blob, filename);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'فشل رفع النسخة الاحتياطية إلى Google Drive.');
  }
  return (await res.json()) as { id: string; name: string };
}
