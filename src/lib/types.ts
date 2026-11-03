/** 資料模型（Phase 1 先定義完整結構，CRUD 於 Phase 2 實作）。 */
export const CATEGORIES = [
  { id: 'tshirt', label: 'T-shirt', group: 'top' },
  { id: 'shirt', label: '襯衫', group: 'top' },
  { id: 'jacket', label: '外套', group: 'outer' },
  { id: 'pants', label: '長褲', group: 'bottom' },
  { id: 'shorts', label: '短褲', group: 'bottom' },
  { id: 'skirt', label: '裙子', group: 'bottom' },
  { id: 'dress', label: '洋裝', group: 'dress' },
  { id: 'shoes', label: '鞋子', group: 'shoes' },
  { id: 'hat', label: '帽子', group: 'accessory' },
  { id: 'bag', label: '包包', group: 'accessory' },
  { id: 'accessory', label: '配件', group: 'accessory' },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]['id'];
export type CategoryGroup = (typeof CATEGORIES)[number]['group'];

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_LABEL: Record<Season, string> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

export interface Garment {
  id: string;
  name: string;
  category: CategoryId;
  color: string;
  brand: string;
  size: string;
  seasons: Season[];
  notes: string;
  originalImageId: string;
  cutoutImageId: string | null;
  /** 列表用縮圖 */
  thumbImageId: string;
  createdAt: number;
  updatedAt: number;
  /** IndexedDB 無法索引 boolean，以 0/1 儲存 */
  favorite: 0 | 1;
}

export type ImageKind = 'garment-original' | 'garment-cutout' | 'person' | 'tryon' | 'thumbnail';
export interface StoredImage {
  id: string;
  kind: ImageKind;
  blob: Blob;
  width: number;
  height: number;
  /** 內容雜湊，用於重複資料檢查 */
  hash: string;
  createdAt: number;
}

export interface PersonPhoto { id: string; imageId: string; name: string; createdAt: number }
export interface TryOnResult { id: string; personId: string; garmentIds: string[]; imageId: string; createdAt: number }
export interface Outfit { id: string; name: string; garmentIds: string[]; tags: string[]; createdAt: number; favorite: 0 | 1 }
export interface HistoryEntry { id: string; type: 'tryon' | 'recommend'; refId: string; createdAt: number }

export type ComputeMode = 'auto' | 'high' | 'balanced' | 'saver';
export interface AppSettings {
  computeMode: ComputeMode;
  backend: 'auto' | 'wasm';
}
export const DEFAULT_SETTINGS: AppSettings = { computeMode: 'auto', backend: 'auto' };
