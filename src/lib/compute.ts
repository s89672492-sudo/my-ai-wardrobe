/** 依「運算模式」決定照片處理尺寸（省電／平衡／高品質）。 */
import { isIOS } from './platform';
import type { AppSettings } from './types';

export const MODE_MAX_SIDE = { high: 1536, balanced: 1024, saver: 640 } as const;

export function resolveMode(s: AppSettings): keyof typeof MODE_MAX_SIDE {
  if (s.computeMode !== 'auto') return s.computeMode;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem !== undefined && mem <= 2) return 'saver';
  if (isIOS) return 'balanced';
  return mem !== undefined && mem >= 6 ? 'high' : 'balanced';
}

export const maxSideFor = (s: AppSettings) => MODE_MAX_SIDE[resolveMode(s)];
export const acceleratorFor = (s: AppSettings) => (s.backend === 'wasm' ? 'wasm' : 'webgpu') as 'wasm' | 'webgpu';
