/** 依「運算模式」決定處理尺寸、網格精細度、預覽頻率與運算後端（省電／平衡／高品質）。 */
import { isIOS } from './platform';
import type { AppSettings } from './types';

export const MODE_MAX_SIDE = { high: 1536, balanced: 1024, saver: 640 } as const;
export type ResolvedMode = keyof typeof MODE_MAX_SIDE;

export interface PerfProfile {
  mode: ResolvedMode;
  maxSide: number;
  /** 試穿最終畫面與拖曳預覽的 TPS 網格 */
  grid: { cols: number; rows: number };
  draftGrid: { cols: number; rows: number };
  /** 拖曳時預覽的最短間隔（ms），省電模式降低更新頻率 */
  draftIntervalMs: number;
  accelerator: 'wasm' | 'webgpu';
  reason: string;
}

// ---- 電量（只有部分瀏覽器提供，例如 Android Chrome；iPhone Safari 不提供）----
let lowBattery = false;
let batteryInfo: { level: number; charging: boolean } | null = null;
export function watchBattery(onChange?: () => void) {
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void }> };
  nav.getBattery?.().then((b) => {
    const upd = () => { batteryInfo = { level: b.level, charging: b.charging }; lowBattery = b.level <= 0.2 && !b.charging; onChange?.(); };
    upd();
    b.addEventListener('levelchange', upd);
    b.addEventListener('chargingchange', upd);
  }).catch(() => {});
}
export const battery = () => batteryInfo;

export function resolveMode(s: AppSettings): { mode: ResolvedMode; reason: string } {
  if (s.computeMode !== 'auto') return { mode: s.computeMode, reason: '手動選擇' };
  if (lowBattery) return { mode: 'saver', reason: '電量低於 20%，自動省電' };
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem !== undefined && mem <= 2) return { mode: 'saver', reason: '裝置記憶體較少' };
  if (isIOS) return { mode: 'balanced', reason: 'iPhone 記憶體限制較嚴格' };
  return mem !== undefined && mem >= 6 ? { mode: 'high', reason: '裝置效能充足' } : { mode: 'balanced', reason: '一般裝置' };
}

export function perfFor(s: AppSettings): PerfProfile {
  const { mode, reason } = resolveMode(s);
  const P = {
    high: { grid: { cols: 18, rows: 26 }, draftGrid: { cols: 10, rows: 14 }, draftIntervalMs: 0 },
    balanced: { grid: { cols: 16, rows: 22 }, draftGrid: { cols: 8, rows: 12 }, draftIntervalMs: 33 },
    saver: { grid: { cols: 12, rows: 16 }, draftGrid: { cols: 6, rows: 9 }, draftIntervalMs: 120 },
  }[mode];
  return { mode, maxSide: MODE_MAX_SIDE[mode], ...P, accelerator: mode === 'saver' || s.backend === 'wasm' ? 'wasm' : 'webgpu', reason };
}

export const maxSideFor = (s: AppSettings) => perfFor(s).maxSide;
export const acceleratorFor = (s: AppSettings) => perfFor(s).accelerator;
