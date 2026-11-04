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
  /** 選填風格標籤（推薦用）：休閒／正式／運動 */
  styles?: ('casual' | 'formal' | 'sport')[];
  /** 誰的衣服（情侶衣櫥）；未設定視為共用 */
  owner?: Owner;
}

/** 她（三花貓）／他（橘貓）／共用 */
export type Owner = 'her' | 'him' | 'both';

export type ImageKind = 'garment-original' | 'garment-cutout' | 'person' | 'person-mask' | 'tryon' | 'thumbnail' | 'avatar';
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

export interface PersonPhoto {
  id: string;
  imageId: string;
  thumbImageId: string;
  /** 人體遮罩 PNG（覆蓋 analysis.maskRect 區域） */
  maskImageId: string | null;
  name: string;
  analysis: import('../ai/body').BodyAnalysis | null;
  /** 使用者是否手動校正過關鍵點 */
  corrected: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface TryOnLayerRecord { garmentId: string; adjust: { dx: number; dy: number; scale: number; rotate: number; length: number } }
export interface TryOnResult {
  id: string; personId: string; garmentIds: string[];
  layers: TryOnLayerRecord[];
  imageId: string; thumbImageId: string;
  options?: OutfitLayerOptions;
  createdAt: number;
}
export interface OutfitLayerOptions { tucked: boolean; openFront: boolean }
export interface Outfit {
  id: string; name: string; garmentIds: string[]; tags: string[]; createdAt: number; favorite: 0 | 1;
  /** 試穿時的圖層選項與每件的調整 */
  options?: OutfitLayerOptions;
  layers?: TryOnLayerRecord[];
  /** 預覽：儲存時的試穿結果 */
  tryOnId?: string; personId?: string; previewImageId?: string;
  /** 來源：手動組合或推薦（Phase 6） */
  source?: 'tryon' | 'recommend';
}
export interface HistoryEntry { id: string; type: 'tryon' | 'recommend'; refId: string; createdAt: number }

export type ComputeMode = 'auto' | 'high' | 'balanced' | 'saver';
export interface AppSettings {
  computeMode: ComputeMode;
  backend: 'auto' | 'wasm';
  /** 新圖片的儲存品質 */
  imageQuality: 'standard' | 'compact';
  /** 上次匯出備份時間 */
  lastBackupAt?: number;
  /** 兩人的暱稱與自訂頭像（頭像圖片只存在這支手機） */
  couple?: CoupleSettings;
}
export interface CoupleSettings { herName: string; himName: string; herAvatarId?: string; himAvatarId?: string }
export const DEFAULT_COUPLE: CoupleSettings = { herName: '小花', himName: '小橘' };
export const DEFAULT_SETTINGS: AppSettings = { computeMode: 'auto', backend: 'auto', imageQuality: 'standard' };
