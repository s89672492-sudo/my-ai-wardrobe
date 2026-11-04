/** AI 模型與執行環境的網址（依 Vite base path）。 */
const BASE = import.meta.env.BASE_URL;
export const WASM_PATH = `${BASE}litert-wasm/`;
export const MODEL_URLS = {
  pose: `${BASE}models/movenet_singlepose_lightning.tflite`,
  segmenter: `${BASE}models/selfie_segmenter.tflite`,
  /** 人體部位分割（頭髮／皮膚／衣服） */
  parser: `${BASE}models/selfie_multiclass_256x256.tflite`,
};
/** 去背模型：只有在新增衣服時才下載（延遲載入） */
export const CUTOUT_MODEL_URL = `${BASE}models/magic_touch.tflite`;
/** 衣服分類模型：新增衣服時才下載 */
export const CLASSIFIER_MODEL_URL = `${BASE}models/efficientnet_lite0.tflite`;
/** 快取名稱綁定 LiteRT 版本：升級時 glue 與 wasm 必須一起更新，舊快取會被清除 */
export const AI_CACHE_NAME = `ai-assets-litert-${__LITERT_VERSION__}-v1`;

export async function cleanupOldAICaches() {
  if (!('caches' in self)) return;
  try { for (const k of await caches.keys()) if (k.startsWith('ai-') && k !== AI_CACHE_NAME) await caches.delete(k); } catch { /* ignore */ }
}

/** 檢查模型是否已存在 Service Worker 快取（可離線使用）。 */
export async function modelsCached(): Promise<boolean> {
  if (!('caches' in self)) return false;
  try {
    const c = await caches.open(AI_CACHE_NAME);
    const hits = await Promise.all([...Object.values(MODEL_URLS), CUTOUT_MODEL_URL, CLASSIFIER_MODEL_URL].map((u) => c.match(new URL(u, location.href).href)));
    return hits.every(Boolean);
  } catch { return false; }
}
