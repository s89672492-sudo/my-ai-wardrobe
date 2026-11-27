/**
 * 雲端 AI 試穿（Google Gemini 圖片模型，使用者自己的 API 金鑰）。
 * - 只有使用者在試穿頁按下「雲端 AI 試穿」並確認後，才會把全身照與衣服照傳到 Google。
 * - 金鑰只存在這支手機的 localStorage，不寫入 IndexedDB，所以不會出現在備份檔，也不在程式碼或 GitHub。
 * - 手機直接呼叫 Google，不經過任何其他伺服器。
 */
export const GEMINI_HOST = 'https://generativelanguage.googleapis.com';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-image';
const KEY = 'wardrobe-gemini-key';
const MODEL_KEY = 'wardrobe-gemini-model';

export function getGeminiKey(): string { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } }
export function setGeminiKey(k: string) { try { if (k) localStorage.setItem(KEY, k.trim()); else localStorage.removeItem(KEY); } catch { /* 私密瀏覽 */ } }
export function getGeminiModel(): string { try { return localStorage.getItem(MODEL_KEY) || DEFAULT_GEMINI_MODEL; } catch { return DEFAULT_GEMINI_MODEL; } }
export function setGeminiModel(m: string) { try { if (m.trim() && m.trim() !== DEFAULT_GEMINI_MODEL) localStorage.setItem(MODEL_KEY, m.trim()); else localStorage.removeItem(MODEL_KEY); } catch { /* ignore */ } }
/** 只顯示前後幾碼，確認貼對了 */
export const maskKey = (k: string) => (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '已設定');

/** 縮成長邊 1024 的 JPEG（減少流量與費用；透明背景補白） */
async function toJpegBase64(src: Blob | HTMLCanvasElement, maxSide = 1024): Promise<string> {
  const bmp = await createImageBitmap(src);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('圖片轉換失敗'))), 'image/jpeg', 0.9));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface CloudGarment { image: Blob | HTMLCanvasElement; label: string }

function prompt(garments: CloudGarment[], extra: string) {
  const list = garments.map((g, i) => `image ${i + 2}: ${g.label}`).join('; ');
  return [
    'Virtual try-on. Image 1 is a photo of a person. The following images are clothing items (' + list + ').',
    'Generate a realistic photo of the SAME person from image 1 wearing these clothing items.',
    'Keep the person\'s face, facial features, hairstyle, skin tone, body shape, pose and the background exactly the same as image 1. Only change the clothes.',
    'Reproduce each garment faithfully: same color, pattern, lace, straps, length and details. The clothes should fit the body naturally with realistic folds, shadows and lighting matching image 1.',
    'Do not add any other people, text or watermarks. Output one image with the same framing as image 1.',
    extra ? `Additional instruction from the user: ${extra}` : '',
  ].filter(Boolean).join('\n');
}

/** 把 Google 的錯誤轉成看得懂的說明 */
function friendly(status: number, msg: string): string {
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) return '金鑰不正確。請到設定頁重新貼上 Gemini 金鑰（AQ. 或 AIza 開頭）。';
  if (status === 403 && /referer|referrer/i.test(msg)) return '金鑰的網站限制擋住了這個 App。請在 Google Cloud 的金鑰設定加入 https://s89672492-sudo.github.io/*';
  if (status === 403) return `Google 拒絕了請求（403）：可能是金鑰沒有開通 Generative Language API，或專案沒有綁定帳單。${msg ? `（${msg.slice(0, 120)}）` : ''}`;
  if (status === 429) return '已達 Google 的使用上限或預算上限，請稍後再試，或到 Google Cloud 查看帳單與配額。';
  if (status === 404) return '找不到這個 Gemini 模型名稱，請到設定頁把模型改回預設值。';
  if (status >= 500) return 'Google 伺服器暫時有問題，請稍後再試。';
  return `雲端 AI 試穿失敗（${status}）：${msg.slice(0, 160)}`;
}

export async function cloudTryOn(person: Blob | HTMLCanvasElement, garments: CloudGarment[], opts: { extra?: string; signal?: AbortSignal } = {}): Promise<Blob> {
  const key = getGeminiKey();
  if (!key) throw new Error('尚未設定 Gemini 金鑰，請先到「設定」貼上。');
  if (!navigator.onLine) throw new Error('目前離線，雲端 AI 試穿需要網路。');
  const parts: unknown[] = [{ text: prompt(garments, opts.extra ?? '') }];
  parts.push({ inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(person) } });
  for (const g of garments) parts.push({ inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(g.image, 768) } });
  const res = await fetch(`${GEMINI_HOST}/v1beta/models/${encodeURIComponent(getGeminiModel())}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
    signal: opts.signal,
  }).catch((e: Error) => { throw new Error(e.name === 'AbortError' ? '已取消' : `無法連線到 Google：${e.message}`); });
  const json = await res.json().catch(() => ({})) as {
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }[] } }[];
  };
  if (!res.ok) throw new Error(friendly(res.status, json.error?.message ?? ''));
  if (json.promptFeedback?.blockReason) throw new Error(`Google 拒絕產生這張圖（${json.promptFeedback.blockReason}）。可以換一張照片或衣服再試。`);
  const c = json.candidates?.[0];
  const img = c?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data);
  const data = img?.inlineData?.data ?? img?.inline_data?.data;
  if (!data) {
    const text = c?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ') ?? '';
    throw new Error(`Gemini 沒有產生圖片${c?.finishReason ? `（${c.finishReason}）` : ''}。${text ? `它的回覆：${text.slice(0, 120)}` : '可以再試一次，或換一張正面全身照。'}`);
  }
  const mime = img?.inlineData?.mimeType ?? img?.inline_data?.mime_type ?? 'image/png';
  const bin = atob(data); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
