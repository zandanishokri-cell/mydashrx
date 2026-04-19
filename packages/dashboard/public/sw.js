/**
 * P-DRV3: MyDashRx Offline POD Service Worker
 * Handles Background Sync for driver stop status updates queued in IndexedDB.
 * Works on Chrome/Android via Background Sync API.
 * iOS/Safari falls back to 30s polling in useOfflineSync.ts.
 */

const SYNC_TAG = 'mdrx-pod-sync';
const DB_NAME = 'mydashrx-offline';
const STORE = 'action_queue';
const TTL_MS = 24 * 60 * 60 * 1000; // 24hr HIPAA TTL

// Background Sync event — Chrome/Android only
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(drainQueue());
  }
});

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function drainQueue() {
  let db;
  try {
    db = await openIdb();
  } catch {
    return;
  }

  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('createdAt').getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });

  const now = Date.now();
  for (const item of items) {
    // HIPAA: discard items older than 24hr without retrying
    if (now - item.createdAt > TTL_MS) {
      await deleteItem(db, item.id);
      console.warn('[sw] pod_sync_expired — discarded stale queue item', item.id);
      continue;
    }

    try {
      const apiBase = self.location.origin;
      let url, method;

      if (item.type === 'status_update') {
        url = `${apiBase}/api/v1/driver/me/stops/${item.stopId}/status`;
        method = 'PATCH';
      } else if (item.type === 'barcode_scan') {
        url = `${apiBase}/api/v1/driver/me/stops/${item.stopId}/barcode`;
        method = 'POST';
      } else if (item.type === 'pod_submit') {
        url = `${apiBase}/api/v1/driver/me/stops/${item.stopId}/pod`;
        method = 'POST';
      } else {
        await deleteItem(db, item.id);
        continue;
      }

      const headers = {
        'Content-Type': 'application/json',
        ...(item.payload?.idempotencyKey ? { 'Idempotency-Key': item.payload.idempotencyKey } : {}),
      };
      // Note: SW cannot access localStorage/sessionStorage — accessToken must be in the payload
      // or the sync falls back to the client-side useOfflineSync hook which has the token.
      // SW drain is best-effort; client hook drain is the primary path.
      const res = await fetch(url, { method, headers, body: JSON.stringify(item.payload) });
      if (res.ok || res.status === 409) {
        // 409 = idempotency duplicate — treat as success
        await deleteItem(db, item.id);
      }
      // non-ok and non-409 = leave in queue for retry
    } catch {
      // Network error — leave in queue, retry on next sync
      break;
    }
  }

  db.close();
}

async function deleteItem(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
    tx.oncomplete = () => {};
  });
}

// P-DEL16: Web Push event handler — shows notification when driver receives mid-route update
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'MyDashRx', body: event.data.text() };
  }
  const options = {
    body: payload.body ?? '',
    tag: payload.tag ?? 'mdrx-driver',
    data: payload.data ?? {},
    badge: '/icon-192.png',
    icon: '/icon-192.png',
    requireInteraction: false,
    silent: false,
  };
  event.waitUntil(self.registration.showNotification(payload.title ?? 'MyDashRx', options));
});

// P-DEL16: Click on push notification — open relevant route page
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const url = data.routeId
    ? `/driver/routes/${data.routeId}`
    : '/driver';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
