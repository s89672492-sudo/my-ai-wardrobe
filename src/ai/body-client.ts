/** 人體辨識（MoveNet + Selfie Segmenter + Multiclass 部位分割）：用到時才載入，離開頁面即釋放。 */
import { AIClient } from './client';
import { MODEL_URLS, WASM_PATH } from './assets';
import type { Accelerator, Keypoint } from './protocol';

let client: AIClient | null = null;
let ready: Promise<Accelerator> | null = null;
let currentId: number | null = null;

export function ensureBodyModels(accelerator: Accelerator, onProgress?: (s: string) => void): Promise<Accelerator> {
  client ??= new AIClient();
  const c = client;
  ready ??= c.init(WASM_PATH, accelerator, MODEL_URLS, onProgress).then((r) => {
    if (r.type !== 'ready') throw new Error('AI 人體辨識啟動失敗');
    const bad = r.models.find((m) => !m.ok);
    if (bad) throw new Error(bad.error ?? '模型載入失敗');
    return r.backend;
  }).catch((e: unknown) => { ready = null; throw e; });
  return ready;
}

export interface AnalyzeOutput { keypoints: Keypoint[]; mask: ImageBitmap; parse?: ImageBitmap; maskRect: { x: number; y: number; w: number; h: number }; ms: number; refined: boolean }

export async function analyzePhoto(bitmap: ImageBitmap, onProgress?: (s: string) => void): Promise<AnalyzeOutput> {
  if (!client) throw new Error('AI 人體辨識尚未啟動');
  const req = client.analyze(bitmap, onProgress);
  currentId = req.id;
  try {
    const r = await req.promise;
    if (r.type === 'cancelled') throw new Error('已取消');
    if (r.type !== 'analyzeResult') throw new Error('AI 人體辨識沒有回傳結果');
    return { keypoints: r.keypoints, mask: r.mask, parse: r.parse, maskRect: r.maskRect, ms: r.timings.totalMs, refined: r.refined };
  } finally { currentId = null; }
}

export const bodyBusy = () => currentId !== null;

export function cancelAnalyze() { if (client && currentId !== null) client.cancel(currentId); }

export async function releaseBodyModels() {
  const c = client;
  client = null; ready = null; currentId = null;
  await c?.terminate();
}
