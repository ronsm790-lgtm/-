import { apiFetch } from './api.ts';

export interface OfflineMutationItem {
  id?: number;
  url: string;
  method: 'POST' | 'PUT' | 'DELETE';
  body: string;
  label: string;
  createdAt: number;
}

const DB_NAME = 'al_muntadhar_offline_queue';
const STORE_NAME = 'mutations';
const DB_VERSION = 1;

type QueueListener = (count: number) => void;
const listeners = new Set<QueueListener>();

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open offline queue'));
  });
}

async function notifyListeners(): Promise<number> {
  const count = await getOfflineQueueCount();
  listeners.forEach((cb) => {
    try {
      cb(count);
    } catch {
      // ignore listener errors
    }
  });
  return count;
}

export function subscribeOfflineQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  void getOfflineQueueCount().then((c) => listener(c));
  return () => {
    listeners.delete(listener);
  };
}

export async function getOfflineQueueCount(): Promise<number> {
  try {
    const db = await openQueueDb();
    return await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      countReq.onsuccess = () => resolve(countReq.result || 0);
      countReq.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

export async function listOfflineQueue(): Promise<OfflineMutationItem[]> {
  try {
    const db = await openQueueDb();
    return await new Promise<OfflineMutationItem[]>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as OfflineMutationItem[]) || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function enqueueOfflineMutation(
  item: Omit<OfflineMutationItem, 'id' | 'createdAt'>
): Promise<void> {
  const db = await openQueueDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add({
      ...item,
      createdAt: Date.now(),
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('Queue add failed'));
  });
  await notifyListeners();
}

async function deleteOfflineMutation(id: number): Promise<void> {
  const db = await openQueueDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

export async function flushOfflineQueue(): Promise<{ synced: number; remaining: number }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { synced: 0, remaining: await getOfflineQueueCount() };
  }
  const items = await listOfflineQueue();
  let synced = 0;
  for (const item of items) {
    try {
      await apiFetch(item.url, {
        method: item.method,
        body: item.body,
      });
      if (typeof item.id === 'number') {
        await deleteOfflineMutation(item.id);
      }
      synced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('401') || msg.includes('403')) {
        break;
      }
      // Keep item in queue if transient/network
      break;
    }
  }
  const remaining = await notifyListeners();
  return { synced, remaining };
}

export async function saveWithOfflineFallback<T>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  payload: unknown,
  label: string
): Promise<{ queued: boolean; response?: T }> {
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('offline');
    }
    const response = await apiFetch<T>(url, { method, body });
    return { queued: false, response };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    const isNetwork =
      msg === 'offline' ||
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('Load failed') ||
      (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (!isNetwork) {
      throw err;
    }
    await enqueueOfflineMutation({ url, method, body, label });
    return { queued: true };
  }
}

let listenerRegistered = false;
export function registerOfflineAutoSync(onSynced?: (synced: number) => void): void {
  if (listenerRegistered || typeof window === 'undefined') return;
  listenerRegistered = true;
  window.addEventListener('online', () => {
    void flushOfflineQueue().then((res) => {
      if (res.synced > 0) {
        onSynced?.(res.synced);
      }
    });
  });
}
