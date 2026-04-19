export type QueuedActionType = 'status_update' | 'barcode_scan' | 'pod_submit';

export interface QueuedAction {
  id: string;
  createdAt: number;
  type: QueuedActionType;
  stopId: string;
  payload: Record<string, unknown>;
}

const DB_NAME = 'mydashrx-offline';
const STORE = 'action_queue';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = e => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = e => reject((e.target as IDBOpenDBRequest).error);
  });
}

export async function enqueueAction(action: Omit<QueuedAction, 'id' | 'createdAt'>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const item: QueuedAction = { ...action, id: crypto.randomUUID(), createdAt: Date.now() };
    const req = tx.objectStore(STORE).add(item);
    req.onsuccess = () => resolve();
    req.onerror = e => reject((e.target as IDBRequest).error);
    tx.oncomplete = () => db.close();
  });
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24hr — HIPAA: PHI not persisted locally beyond 24hr

export async function getAllActions(): Promise<QueuedAction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const idx = store.index('createdAt');
    const req = idx.getAll();
    req.onsuccess = async (e) => {
      const all = (e.target as IDBRequest<QueuedAction[]>).result;
      const now = Date.now();
      // Purge expired items (HIPAA 24hr TTL on locally-stored PHI)
      const stale = all.filter(a => now - a.createdAt > TTL_MS);
      for (const item of stale) {
        store.delete(item.id);
        console.warn('[offline-queue] purged expired item', item.id, 'pod_sync_expired');
      }
      resolve(all.filter(a => now - a.createdAt <= TTL_MS));
    };
    req.onerror = e => reject((e.target as IDBRequest).error);
    tx.oncomplete = () => db.close();
  });
}

export async function removeAction(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = e => reject((e.target as IDBRequest).error);
    tx.oncomplete = () => db.close();
  });
}

export async function getPendingCount(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = e => resolve((e.target as IDBRequest<number>).result);
    req.onerror = e => reject((e.target as IDBRequest).error);
    tx.oncomplete = () => db.close();
  });
}
