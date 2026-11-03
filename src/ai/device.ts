/** 裝置能力偵測（主執行緒）。不送出任何資料到網路。 */
export interface DeviceReport {
  userAgent: string;
  platform: string;
  isIOS: boolean;
  isAndroid: boolean;
  deviceMemoryGB?: number;
  cores?: number;
  webgpuApi: boolean;
  webgpuAdapter: 'ok' | 'none' | 'error' | 'n/a';
  webgpuInfo?: string;
  webgpuError?: string;
  maxBufferMB?: number;
  offscreenCanvas: boolean;
  createImageBitmap: boolean;
  moduleWorker: boolean;
  indexedDB: boolean;
  serviceWorker: boolean;
  crossOriginIsolated: boolean;
  storageQuotaMB?: number;
  storageUsageMB?: number;
  storagePersisted?: boolean;
  standalone: boolean;
  jsHeapLimitMB?: number;
}

export async function detectDevice(): Promise<DeviceReport> {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const r: DeviceReport = {
    userAgent: ua,
    platform: navigator.platform,
    isIOS,
    isAndroid: /Android/.test(ua),
    deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    cores: navigator.hardwareConcurrency,
    webgpuApi: 'gpu' in navigator,
    webgpuAdapter: 'n/a',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    createImageBitmap: typeof createImageBitmap === 'function',
    moduleWorker: supportsModuleWorker(),
    indexedDB: typeof indexedDB !== 'undefined',
    serviceWorker: 'serviceWorker' in navigator,
    crossOriginIsolated: self.crossOriginIsolated === true,
    standalone: matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
  const mem = (performance as Performance & { memory?: { jsHeapSizeLimit: number } }).memory;
  if (mem) r.jsHeapLimitMB = mem.jsHeapSizeLimit / 1048576;
  if (r.webgpuApi) {
    try {
      const adapter = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter();
      if (adapter) {
        r.webgpuAdapter = 'ok';
        const info = adapter.info;
        r.webgpuInfo = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' / ') || '（瀏覽器未提供）';
        r.maxBufferMB = adapter.limits.maxBufferSize / 1048576;
      } else r.webgpuAdapter = 'none';
    } catch (e) {
      r.webgpuAdapter = 'error';
      r.webgpuError = e instanceof Error ? e.message : String(e);
    }
  }
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      r.storageQuotaMB = (est.quota ?? 0) / 1048576;
      r.storageUsageMB = (est.usage ?? 0) / 1048576;
      r.storagePersisted = await navigator.storage.persisted?.();
    } catch { /* 部分瀏覽器在私密模式會拋錯 */ }
  }
  return r;
}

function supportsModuleWorker(): boolean {
  let supports = false;
  try {
    // 用 blob: URL（CSP 允許），不用 data:
    const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
    const w = new Worker(url, { get type() { supports = true; return 'module' as const; } });
    w.terminate();
    URL.revokeObjectURL(url);
  } catch { /* ignore */ }
  return supports;
}

/** 依裝置推薦運算模式 */
export function recommendMode(d: DeviceReport): { mode: 'high' | 'balanced' | 'saver'; maxSide: number; reason: string } {
  const mem = d.deviceMemoryGB;
  if (mem !== undefined && mem <= 2) return { mode: 'saver', maxSide: 640, reason: '裝置記憶體 ≤ 2GB' };
  if (d.isIOS) return { mode: 'balanced', maxSide: 1024, reason: 'iOS Safari 記憶體上限較嚴格' };
  if (d.webgpuAdapter === 'ok' && (mem ?? 4) >= 4) return { mode: 'high', maxSide: 1536, reason: '支援 WebGPU 且記憶體充足' };
  return { mode: 'balanced', maxSide: 1024, reason: '一般裝置' };
}
