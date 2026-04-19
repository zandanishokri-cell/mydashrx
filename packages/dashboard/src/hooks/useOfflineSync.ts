'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { getAllActions, removeAction, getPendingCount } from '@/lib/offline-queue';
import type { QueuedAction } from '@/lib/offline-queue';
import { api } from '@/lib/api';

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    try {
      setPendingCount(await getPendingCount());
    } catch { /* ignore */ }
  }, []);

  const processAction = useCallback(async (action: QueuedAction): Promise<void> => {
    const { type, stopId, payload } = action;
    if (type === 'status_update') {
      await api.patch(`/driver/me/stops/${stopId}/status`, payload);
    } else if (type === 'barcode_scan') {
      await api.post(`/driver/me/stops/${stopId}/barcode`, payload);
    } else if (type === 'pod_submit') {
      await api.post(`/driver/me/stops/${stopId}/pod`, payload);
    }
  }, []);

  const syncQueue = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const actions = await getAllActions();
      for (const action of actions) {
        try {
          await processAction(action);
          await removeAction(action.id);
        } catch {
          break; // retry next time
        }
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refreshCount();
    }
  }, [processAction, refreshCount]);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    refreshCount();

    const onOnline = () => { setIsOnline(true); syncQueue(); };
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // iOS 30s polling fallback — Background Sync API absent on iOS/Safari
    // Drains queue when online; no-op when offline (syncQueue guard handles this)
    const iosInterval = setInterval(() => { if (navigator.onLine) syncQueue(); }, 30_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(iosInterval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { isOnline, pendingCount, syncing, syncQueue, refreshCount };
}
