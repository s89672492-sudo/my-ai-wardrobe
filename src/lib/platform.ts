/** 平台相關：安裝提示、離線狀態、儲存空間。 */
import { useEffect, useState, useSyncExternalStore } from 'react';

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; listeners.forEach((l) => l()); });
addEventListener('appinstalled', () => { deferred = null; listeners.forEach((l) => l()); });

/** Android Chrome 可直接跳出安裝視窗；iOS 只能引導使用者手動加入主畫面。 */
export function useInstallPrompt() {
  const canPrompt = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => deferred !== null);
  return {
    canPrompt,
    async prompt() {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      listeners.forEach((l) => l());
      return outcome === 'accepted';
    },
  };
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);
  return online;
}

export interface StorageInfo { usageMB: number; quotaMB: number; persisted: boolean }
export async function getStorageInfo(): Promise<StorageInfo | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const e = await navigator.storage.estimate();
    return { usageMB: (e.usage ?? 0) / 1048576, quotaMB: (e.quota ?? 0) / 1048576, persisted: (await navigator.storage.persisted?.()) ?? false };
  } catch { return null; }
}

export async function requestPersist(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

export function formatMB(mb: number) { return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`; }
