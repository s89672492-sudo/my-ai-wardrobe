/**
 * 多件組合的圖層規劃（純函式）。
 * 圖層由下往上：人物 → 下身 → 上衣 → 外套 → 手臂前景（各圖層依自己的袖長挖出手臂）。
 * 不是「依點選順序直接疊」：規則決定衝突、順序與裁切。
 */
import type { TryOnKind } from './garmentAnchors';

export type Slot = 'bottom' | 'top' | 'outer' | 'dress';
export const SLOT_ZH: Record<Slot, string> = { bottom: '下身', top: '上衣', outer: '外套', dress: '洋裝' };
export const SLOT_OF: Record<TryOnKind, Slot> = { pants: 'bottom', shorts: 'bottom', skirt: 'bottom', top: 'top', outer: 'outer', dress: 'dress' };

export interface OutfitOptions { tucked: boolean; openFront: boolean }
export const DEFAULT_OPTIONS: OutfitOptions = { tucked: false, openFront: false };

/** 選擇一件衣服後的組合（同一位置替換；洋裝與上衣／下身互斥） */
export function selectInto<T>(current: Partial<Record<Slot, T>>, slot: Slot, item: T): { next: Partial<Record<Slot, T>>; removed: Slot[] } {
  const next = { ...current };
  const removed: Slot[] = [];
  const drop = (s: Slot) => { if (next[s] !== undefined) { delete next[s]; removed.push(s); } };
  if (slot === 'dress') { drop('top'); drop('bottom'); }
  if (slot === 'top' || slot === 'bottom') drop('dress');
  next[slot] = item;
  return { next, removed };
}

export interface PlannedLayer {
  slot: Slot;
  /** 繪製順序（小的先畫） */
  z: number;
  /** 把此圖層在身體軸向 t 以下的部分裁掉（上衣紮進下身時） */
  cutBelowT: number | null;
  /** 外套敞開：挖掉前襟 */
  openFront: boolean;
}

/** 下身腰頭在身體軸向的位置（與 bodyTargets 一致） */
export const BAND_T: Record<'pants' | 'shorts' | 'skirt', number> = { pants: 0.82, shorts: 0.82, skirt: 0.72 };

export function planLayers(kinds: Partial<Record<Slot, TryOnKind>>, opt: OutfitOptions): PlannedLayer[] {
  const out: PlannedLayer[] = [];
  const bottom = kinds.bottom as 'pants' | 'shorts' | 'skirt' | undefined;
  if (bottom) out.push({ slot: 'bottom', z: 10, cutBelowT: null, openFront: false });
  if (kinds.dress) out.push({ slot: 'dress', z: 20, cutBelowT: null, openFront: false });
  if (kinds.top) {
    const tuck = opt.tucked && !!bottom;
    // 紮進：上衣畫在下身之下，並在腰頭稍下方截斷（避免下襬從褲子兩側露出）
    out.push({ slot: 'top', z: tuck ? 5 : 20, cutBelowT: tuck ? BAND_T[bottom!] + 0.06 : null, openFront: false });
  }
  if (kinds.outer) out.push({ slot: 'outer', z: 30, cutBelowT: null, openFront: opt.openFront });
  return out.sort((a, b) => a.z - b.z);
}
