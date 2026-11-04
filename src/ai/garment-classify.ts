/** 衣服分類（EfficientNet-Lite0）：新增衣服時才載入，離開編輯頁即釋放。 */
import { AIClient } from './client';
import { CLASSIFIER_MODEL_URL, WASM_PATH } from './assets';
import { shapeOf, suggestCategory, type CategorySuggestion } from './category';

let client: AIClient | null = null;
let ready: Promise<void> | null = null;

function ensure(): Promise<void> {
  client ??= new AIClient();
  const c = client;
  ready ??= c.init(WASM_PATH, 'wasm', { classifier: CLASSIFIER_MODEL_URL }).then((r) => {
    if (r.type !== 'ready' || !r.models[0]?.ok) throw new Error(r.type === 'ready' ? r.models[0]?.error ?? '分類模型載入失敗' : '分類模型啟動失敗');
  }).catch((e: unknown) => { ready = null; throw e; });
  return ready;
}

/** 輸入去背後的衣服（透明背景）。失敗時回傳 null，不影響新增衣服 */
export async function classifyGarment(cutout: HTMLCanvasElement): Promise<CategorySuggestion | null> {
  try {
    await ensure();
    const r = await client!.classify(await createImageBitmap(cutout)).promise;
    if (r.type !== 'classifyResult') return null;
    const d = cutout.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, cutout.width, cutout.height).data;
    return suggestCategory(r.top, shapeOf(d, cutout.width, cutout.height));
  } catch { return null; }
}

export async function releaseClassifier() {
  const c = client;
  client = null; ready = null;
  await c?.terminate();
}
