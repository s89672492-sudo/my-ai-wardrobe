/** 資料模型（Phase 1 先定義完整結構，CRUD 於 Phase 2 實作）。 */
export const CATEGORIES = [
  { id: 'tshirt', label: 'T-shirt', group: 'top' },
  { id: 'shirt', label: '襯衫', group: 'top' },
  { id: 'tank', label: '背心', group: 'top' },
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
  /** 舊版情侶衣櫥的擁有者；已改為個人衣櫥，保留不使用 */
  owner?: Owner;
}

/** 她／他／共用 */
export type Owner = 'her' | 'him' | 'both';

export type ImageKind = 'garment-original' | 'garment-cutout' | 'person' | 'person-mask' | 'person-parse' | 'tryon' | 'thumbnail' | 'avatar';
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
  /** 人體部位圖（R=頭髮、G=皮膚、B=衣服；與遮罩同範圍）。舊資料沒有，重新辨識後產生 */
  parseImageId?: string | null;
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
  /** 試穿光影融合強度 0~100（預設 60） */
  tryOnShading?: number;
  /** 試穿時擦掉露出來的舊衣服（預設開啟） */
  tryOnErase?: boolean;
  /** 外觀：跟隨系統／淺色／深色 */
  theme?: 'auto' | 'light' | 'dark';
  /** 舊版：兩人的暱稱與頭像（已改成個人衣櫥，保留舊資料不使用） */
  couple?: CoupleSettings;
  /** 我的名字與頭像（頭像圖片只存在這支手機） */
  me?: { name: string; avatarId?: string };
  /** 新增／重新處理衣服時預設的去背方式 */
  cutoutMethod?: CutoutMethod;
  /** 判斷種類、顏色、季節、風格、名稱：本機（免費）或 Gemini（付費） */
  judgeMethod?: JudgeMethod;
}
/** local＝手機免費；gemini-redraw＝Gemini 在白底重畫；gemini-mask＝Gemini 只標出衣服範圍 */
export type CutoutMethod = 'local' | 'gemini-redraw' | 'gemini-mask';
export type JudgeMethod = 'local' | 'gemini';
export interface CoupleSettings { herName: string; himName: string; herAvatarId?: string; himAvatarId?: string }
export const DEFAULT_COUPLE: CoupleSettings = { herName: '她', himName: '他' };
export const DEFAULT_SETTINGS: AppSettings = { computeMode: 'auto', backend: 'auto', imageQuality: 'standard' };
