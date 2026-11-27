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
/** 使用者自己指定的圖片模型（沒指定回傳空字串＝自動） */
export function getGeminiModel(): string { try { return localStorage.getItem(MODEL_KEY) ?? ''; } catch { return ''; } }
export function setGeminiModel(m: string) { try { if (m.trim()) localStorage.setItem(MODEL_KEY, m.trim()); else localStorage.removeItem(MODEL_KEY); } catch { /* ignore */ } }
/** 只顯示前後幾碼，確認貼對了 */
export const maskKey = (k: string) => (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '已設定');

/** 縮成長邊 1024 的 JPEG（減少流量與費用；透明背景補白） */
export async function toJpegBase64(src: Blob | HTMLCanvasElement, maxSide = 1024): Promise<string> {
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

/** 呼叫 Gemini generateContent（金鑰放在 header，不放網址） */
export async function geminiCall(model: string, body: unknown, signal?: AbortSignal): Promise<GeminiResponse> {
  const key = getGeminiKey();
  if (!key) throw new Error('尚未設定 Gemini 金鑰，請先到「設定」貼上。');
  if (!navigator.onLine) throw new Error('目前離線，雲端 AI 需要網路。');
  const res = await fetch(`${GEMINI_HOST}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  }).catch((e: Error) => { throw new Error(e.name === 'AbortError' ? '已取消' : `無法連線到 Google：${e.message}`); });
  const json = await res.json().catch(() => ({})) as GeminiResponse & { error?: { message?: string } };
  if (!res.ok) { const err = new Error(friendly(res.status, json.error?.message ?? '')) as GeminiError; err.status = res.status; err.raw = json.error?.message ?? ''; err.model = model; throw err; }
  if (json.promptFeedback?.blockReason) throw new Error(`Google 拒絕處理這張圖（${json.promptFeedback.blockReason}）。`);
  return json;
}
export type GeminiError = Error & { status?: number; raw?: string; model?: string };

/* ---------- 自動選模型：Google 停用或改名時，自動換成金鑰可用的模型 ---------- */

export type ModelKind = 'image' | 'text';
const AUTO_KEY = (k: ModelKind) => `wardrobe-gemini-auto-${k}`;
const DEFAULT_OF = (k: ModelKind) => (k === 'image' ? DEFAULT_GEMINI_MODEL : DEFAULT_GEMINI_TEXT_MODEL);
const ls = { get: (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } }, set: (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* ignore */ } } };

/** 這一類工作目前要用的模型：自訂（只有圖片）→ 上次自動選到的 → 預設 */
export function currentModel(kind: ModelKind): string {
  return (kind === 'image' ? ls.get(MODEL_KEY) : '') || ls.get(AUTO_KEY(kind)) || DEFAULT_OF(kind);
}

export interface ModelInfo { name: string; supportedGenerationMethods?: string[] }
const SKIP = /embedding|aqa|tts|live|audio|native|imagen|veo|learnlm|gemma|robotics|computer-use|lyria|nano/i;

/** 從金鑰可用的模型清單挑出適合的，依「正式版優先、flash 優先（便宜）、版本新優先」排序 */
export function rankModels(models: ModelInfo[], kind: ModelKind): string[] {
  const tier = (n: string) => (/flash-lite/.test(n) ? 1 : /flash/.test(n) ? 2 : /pro/.test(n) ? 0 : -1);
  const ver = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const stable = (n: string) => (/preview|exp/.test(n) ? 0 : 1);
  return models
    .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => n.startsWith('gemini') && !SKIP.test(n) && (kind === 'image' ? /image/.test(n) : !/image/.test(n)))
    .sort((a, b) => stable(b) - stable(a) || tier(b) - tier(a) || ver(b) - ver(a) || a.length - b.length);
}

let modelList: Promise<ModelInfo[]> | null = null;
/** 問 Google 這把金鑰能用哪些模型（不收費） */
export function listModels(fresh = false): Promise<ModelInfo[]> {
  if (fresh) modelList = null;
  modelList ??= (async () => {
    const res = await fetch(`${GEMINI_HOST}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': getGeminiKey() } })
      .catch((e: Error) => { throw new Error(`無法連線到 Google：${e.message}`); });
    const json = await res.json().catch(() => ({})) as { models?: ModelInfo[]; error?: { message?: string } };
    if (!res.ok) { const err = new Error(friendly(res.status, json.error?.message ?? '')) as GeminiError; err.status = res.status; throw err; }
    return json.models ?? [];
  })().catch((e: unknown) => { modelList = null; throw e; });
  return modelList;
}

/** 重新偵測並記住每一類要用的模型；回傳選到的模型 */
export async function detectModels(): Promise<Record<ModelKind, string | null>> {
  const list = await listModels(true);
  const out = { image: rankModels(list, 'image')[0] ?? null, text: rankModels(list, 'text')[0] ?? null };
  for (const k of ['image', 'text'] as const) {
    const names = new Set(list.map((m) => m.name.replace(/^models\//, '')));
    // 目前用的模型還在就不換；不在了才換成偵測到的
    if (!names.has(currentModel(k)) && out[k]) { if (k === 'image') ls.set(MODEL_KEY, ''); ls.set(AUTO_KEY(k), out[k] === DEFAULT_OF(k) ? '' : out[k]!); }
    out[k] = names.has(currentModel(k)) ? currentModel(k) : out[k];
  }
  return out;
}

const modelProblem = (e: GeminiError) => e.status === 404
  || ((e.status === 400 || e.status === 403) && /model|not found|not supported|no longer|deprecated|modalit/i.test(e.raw ?? ''));
const thinkingProblem = (e: GeminiError) => e.status === 400 && /thinking/i.test(e.raw ?? '');

/**
 * 呼叫 Gemini，模型不能用時自動換：查金鑰可用的模型清單、依序改用下一個，成功後記住。
 * 換模型的失敗請求 Google 不收費（404／400 錯誤）。
 */
export async function geminiGenerate(kind: ModelKind, body: { generationConfig?: Record<string, unknown> } & Record<string, unknown>, signal?: AbortSignal): Promise<GeminiResponse> {
  const tried = new Set<string>();
  let model = currentModel(kind);
  let req = body;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await geminiCall(model, req, signal);
      if (model !== currentModel(kind)) { if (kind === 'image') ls.set(MODEL_KEY, ''); ls.set(AUTO_KEY(kind), model === DEFAULT_OF(kind) ? '' : model); }
      return r;
    } catch (e) {
      const err = e as GeminiError;
      if (thinkingProblem(err) && req.generationConfig?.thinkingConfig) {
        const { thinkingConfig: _drop, ...gc } = req.generationConfig; void _drop;
        req = { ...req, generationConfig: gc };
        continue;
      }
      if (!modelProblem(err)) throw err;
      tried.add(model);
      const next = rankModels(await listModels(), kind).find((n) => !tried.has(n));
      if (!next) {
        const none = new Error(`你的 Gemini 金鑰目前沒有可用的${kind === 'image' ? '圖片' : '文字'}模型（試過：${[...tried].join('、')}）。請到 Google AI Studio 確認金鑰與帳單。`) as GeminiError;
        none.status = 404;
        throw none;
      }
      model = next;
    }
  }
  throw new Error('Gemini 模型一直無法使用，請稍後再試。');
}

type GeminiPart = { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } };
export interface GeminiResponse { promptFeedback?: { blockReason?: string }; candidates?: { finishReason?: string; content?: { parts?: GeminiPart[] } }[] }
export const responseText = (r: GeminiResponse) => r.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
export function responseImage(r: GeminiResponse): Blob | null {
  const img = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data);
  const data = img?.inlineData?.data ?? img?.inline_data?.data;
  if (!data) return null;
  return base64ToBlob(data, img?.inlineData?.mimeType ?? img?.inline_data?.mime_type ?? 'image/png');
}
export function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** 把 Google 的錯誤轉成看得懂的說明 */
function friendly(status: number, msg: string): string {
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) return '金鑰不正確。請到設定頁重新貼上 Gemini 金鑰（AQ. 或 AIza 開頭）。';
  if (status === 403 && /referer|referrer/i.test(msg)) return '金鑰的網站限制擋住了這個 App。請在 Google Cloud 的金鑰設定加入 https://s89672492-sudo.github.io/*';
  if (status === 403) return `Google 拒絕了請求（403）：可能是金鑰沒有開通 Generative Language API，或專案沒有綁定帳單。${msg ? `（${msg.slice(0, 120)}）` : ''}`;
  if (status === 429) return '已達 Google 的使用上限或預算上限，請稍後再試，或到 Google Cloud 查看帳單與配額。';
  if (status === 404) return '找不到這個 Gemini 模型（Google 可能已停用），App 會自動改用可用的模型。';
  if (status >= 500) return 'Google 伺服器暫時有問題，請稍後再試。';
  return `雲端 AI 失敗（${status}）：${msg.slice(0, 160)}`;
}

export async function cloudTryOn(person: Blob | HTMLCanvasElement, garments: CloudGarment[], opts: { extra?: string; signal?: AbortSignal } = {}): Promise<Blob> {
  const key = getGeminiKey();
  if (!key) throw new Error('尚未設定 Gemini 金鑰，請先到「設定」貼上。');
  if (!navigator.onLine) throw new Error('目前離線，雲端 AI 試穿需要網路。');
  const parts: unknown[] = [{ text: prompt(garments, opts.extra ?? '') }];
  parts.push({ inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(person) } });
  for (const g of garments) parts.push({ inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(g.image, 768) } });
  const r = await geminiGenerate('image', { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }, opts.signal);
  const img = responseImage(r);
  if (!img) {
    const c = r.candidates?.[0];
    const text = responseText(r);
    throw new Error(`Gemini 沒有產生圖片${c?.finishReason ? `（${c.finishReason}）` : ''}。${text ? `它的回覆：${text.slice(0, 120)}` : '可以再試一次，或換一張正面全身照。'}`);
  }
  return img;
}

/** 問 AI 怎麼搭：Gemini 文字模型（看得懂圖片），費用遠低於圖片模型 */
export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
export interface StylistItem { ref: string; image: Blob; desc: string }
export interface StylistTurn { role: 'user' | 'model'; text: string }

export async function askStylist(items: StylistItem[], turns: StylistTurn[], opts: { who: string; season: string; signal?: AbortSignal }): Promise<string> {
  const key = getGeminiKey();
  if (!key) throw new Error('尚未設定 Gemini 金鑰，請先到「設定」貼上。');
  if (!navigator.onLine) throw new Error('目前離線，問 AI 需要網路。');
  const sys = [
    `你是貼心的穿搭顧問，用繁體中文、口語、簡短回答（150 字內）。現在是${opts.season}，幫「${opts.who}」搭配。`,
    '只能使用下面衣櫥清單裡的衣服，每件衣服前面有編號與一張照片。不要推薦清單以外的衣服；衣櫥缺少的單品可以建議「可以考慮添購…」。',
    '回答最後一行固定寫出你推薦的衣服編號，格式：[[推薦:#3,#7]]；沒有要推薦就寫 [[推薦:]]。',
  ].join('\n');
  const wardrobe: unknown[] = [{ text: '衣櫥清單：' }];
  for (const it of items) {
    wardrobe.push({ text: `${it.ref}：${it.desc}` });
    wardrobe.push({ inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(it.image, 256) } });
  }
  const contents = [
    { role: 'user', parts: wardrobe },
    { role: 'model', parts: [{ text: '好的，我看過你的衣櫥了，請問想怎麼搭？[[推薦:]]' }] },
    ...turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
  ];
  const r = await geminiGenerate('text', { systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature: 0.7, maxOutputTokens: 800 } }, opts.signal);
  const text = responseText(r);
  if (!text) throw new Error('AI 沒有回覆，請換個問法再試一次。');
  return text;
}

/** 從回覆中取出推薦編號（#3 → 3），並去掉標記 */
export function parseStylistReply(text: string): { body: string; refs: string[] } {
  const m = text.match(/\[\[推薦:([^\]]*)\]\]/);
  const refs = m ? (m[1]!.match(/#\d+/g) ?? []) : [];
  return { body: text.replace(/\[\[推薦:[^\]]*\]\]/g, '').trim(), refs: [...new Set(refs)] };
}
