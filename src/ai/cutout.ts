/** 衣服 AI 去背（MagicTouch）：第一次使用時才載入模型，離開編輯畫面即釋放記憶體。 */
import { AIClient } from './client';
import { CUTOUT_MODEL_URL, WASM_PATH } from './assets';
import type { Accelerator } from './protocol';

let client: AIClient | null = null;
let ready: Promise<void> | null = null;

export function ensureCutoutModel(accelerator: Accelerator, onProgress?: (s: string) => void): Promise<void> {
  client ??= new AIClient();
  const c = client;
  ready ??= c.init(WASM_PATH, accelerator, { magicTouch: CUTOUT_MODEL_URL }, onProgress).then((r) => {
    if (r.type !== 'ready') throw new Error('AI 去背啟動失敗');
    const m = r.models[0];
    if (!m?.ok) throw new Error(m?.error ?? 'AI 去背模型載入失敗');
  }).catch((e: unknown) => { ready = null; throw e; });
  return ready;
}

export async function runCutout(bitmap: ImageBitmap, points: { x: number; y: number }[], onProgress?: (s: string) => void): Promise<ImageBitmap> {
  if (!client) throw new Error('AI 去背尚未啟動');
  const r = await client.cutout(bitmap, points, onProgress).promise;
  if (r.type !== 'cutoutResult') throw new Error('去背已取消');
  return r.mask;
}

export async function releaseCutoutModel() {
  const c = client;
  client = null;
  ready = null;
  await c?.terminate();
}
