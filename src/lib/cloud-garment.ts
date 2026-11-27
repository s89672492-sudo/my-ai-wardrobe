/**
 * 付費的 Gemini 衣服處理（使用者自己的金鑰，按下開始並確認費用後才會上傳）：
 * - redraw：Gemini 圖片模型把衣服重新畫在純白背景，再由手機去掉白底
 * - mask：Gemini 文字模型標出衣服範圍（遮罩），用原本的照片去背，花紋不會變
 * - judge：判斷種類、顏色、季節、風格與名稱
 */
import { base64ToBlob, DEFAULT_GEMINI_TEXT_MODEL, geminiCall, getGeminiModel, responseImage, responseText, toJpegBase64 } from './cloud-tryon';
import { COLORS } from './image';
import { CATEGORIES, SEASONS, type CategoryId, type Season } from './types';

/** 大約費用（新台幣，每件），用於開始前的預估 */
export const COST_NT = { redraw: 1.3, mask: 0.05, judge: 0.05 } as const;

/** 重畫在白底：回傳 Gemini 畫的圖（白底）；之後由 whiteToAlpha 去掉白底 */
export async function geminiRedraw(photo: Blob | HTMLCanvasElement, signal?: AbortSignal): Promise<Blob> {
  const r = await geminiCall(getGeminiModel(), {
    contents: [{ role: 'user', parts: [
      { text: [
        'Product photo editing. Take the single main clothing item in this photo and show ONLY that garment, laid flat / ghost-mannequin style, front view, centered, on a pure solid white background (#FFFFFF).',
        'Remove the person, hanger, hands, mannequin, other objects and the original background. No shadow on the background.',
        'Keep the garment exactly the same: same color, fabric, pattern, print, logo, lace, buttons, straps, length and shape. Do not invent details. Do not add text or watermarks.',
      ].join('\n') },
      { inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(photo, 1024) } },
    ] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  }, signal);
  const img = responseImage(r);
  if (!img) throw new Error(`Gemini 沒有畫出衣服${r.candidates?.[0]?.finishReason ? `（${r.candidates[0].finishReason}）` : ''}。`);
  return img;
}

/**
 * Gemini 標出衣服範圍。回傳和輸入圖同尺寸的灰階遮罩（白＝衣服）；找不到衣服回傳 null。
 * 格式見 Gemini 2.5 的影像分割：box_2d 為 [y0,x0,y1,x1]（0–1000），mask 為該框內的 PNG。
 */
export async function geminiMask(photo: HTMLCanvasElement, signal?: AbortSignal): Promise<HTMLCanvasElement | null> {
  const r = await geminiCall(DEFAULT_GEMINI_TEXT_MODEL, {
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(photo, 1024) } },
      { text: 'Give the segmentation mask for the single main clothing item (garment, shoes, bag or accessory) in this image. Do not include the person, skin, hair, hanger or background. Output a JSON list with one entry containing the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label".' },
    ] }],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 }, temperature: 0.2 },
  }, signal);
  const text = responseText(r).replace(/^```(?:json)?\s*|\s*```$/g, '');
  let list: { box_2d?: number[]; mask?: string }[];
  try { list = JSON.parse(text) as typeof list; } catch { throw new Error('Gemini 回傳的衣服範圍格式看不懂，可以再試一次或改用免費去背。'); }
  const best = (Array.isArray(list) ? list : []).filter((m) => m.box_2d?.length === 4 && m.mask)
    .sort((a, b) => area(b.box_2d!) - area(a.box_2d!))[0];
  if (!best) return null;
  const [y0, x0, y1, x1] = best.box_2d!.map((v) => Math.max(0, Math.min(1000, v)) / 1000) as [number, number, number, number];
  const W = photo.width, H = photo.height;
  const bx = Math.round(x0 * W), by = Math.round(y0 * H), bw = Math.round((x1 - x0) * W), bh = Math.round((y1 - y0) * H);
  if (bw < 4 || bh < 4) return null;
  const png = best.mask!.replace(/^data:image\/\w+;base64,/, '');
  const bmp = await createImageBitmap(base64ToBlob(png, 'image/png'));
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const x = out.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(bmp, bx, by, bw, bh);
  bmp.close();
  // 機率圖 → 透明度（>0.5 為衣服，邊緣保留一點柔和）
  const d = x.getImageData(0, 0, W, H);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = d.data[i]!;
    const a = v <= 102 ? 0 : v >= 153 ? 255 : Math.round(((v - 102) / 51) * 255);
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = a;
  }
  x.putImageData(d, 0, 0);
  return out;
}
const area = (b: number[]) => (b[2]! - b[0]!) * (b[3]! - b[1]!);

/** 把「純白背景」變透明：只去掉和四周邊框相連的白色（衣服裡面的白色不會被挖掉） */
export function whiteToAlpha(c: HTMLCanvasElement): { data: Uint8ClampedArray; ratio: number } {
  const W = c.width, H = c.height;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const img = x.getImageData(0, 0, W, H), d = img.data;
  const near = (i: number, t: number) => { const r = d[i * 4]!, g = d[i * 4 + 1]!, b = d[i * 4 + 2]!; return Math.min(r, g, b) >= t && Math.max(r, g, b) - Math.min(r, g, b) < 18; };
  const bg = new Uint8Array(W * H);
  const stack: number[] = [];
  const push = (i: number) => { if (!bg[i] && near(i, 236)) { bg[i] = 1; stack.push(i); } };
  for (let X = 0; X < W; X++) { push(X); push((H - 1) * W + X); }
  for (let Y = 0; Y < H; Y++) { push(Y * W); push(Y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop()!, X = i % W, Y = (i / W) | 0;
    if (X > 0) push(i - 1); if (X < W - 1) push(i + 1);
    if (Y > 0) push(i - W); if (Y < H - 1) push(i + W);
  }
  let fg = 0;
  for (let i = 0; i < W * H; i++) {
    if (bg[i]) { d[i * 4 + 3] = 0; continue; }
    fg++;
    // 緊鄰背景的邊緣像素：依亮度做一點半透明，邊緣比較不會有白邊
    const X = i % W, Y = (i / W) | 0;
    const edge = (X > 0 && bg[i - 1]) || (X < W - 1 && bg[i + 1]) || (Y > 0 && bg[i - W]) || (Y < H - 1 && bg[i + W]);
    if (edge) { const m = Math.min(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!); d[i * 4 + 3] = m > 200 ? Math.round(255 * Math.max(0.35, (255 - m) / 55)) : 255; }
  }
  x.putImageData(img, 0, 0);
  return { data: d, ratio: fg / (W * H) };
}

export interface GarmentJudgement { category: CategoryId; color: string; seasons: Season[]; styles: ('casual' | 'formal' | 'sport')[]; name: string }

/** Gemini 判斷種類、顏色、季節、風格、名稱（JSON 結構化輸出） */
export async function geminiJudge(image: Blob | HTMLCanvasElement, signal?: AbortSignal): Promise<GarmentJudgement> {
  const cats = CATEGORIES.map((c) => `${c.id}=${c.label}`).join(', ');
  const colors = COLORS.map((c) => c.label);
  const r = await geminiCall(DEFAULT_GEMINI_TEXT_MODEL, {
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(image, 512) } },
      { text: [
        '這是一件衣服（或鞋、包、配件）的照片。請判斷：',
        `category：只能是其中一個 id（${cats}）。無袖細肩帶或背心選 tank；有領有扣選 shirt；連身裙選 dress。`,
        'color：主要顏色，只能從清單中選一個；花色很多選「多色」。',
        'seasons：適合穿的季節（spring/summer/autumn/winter，可多選）。',
        'styles：casual（休閒）、formal（正式）、sport（運動），可多選，至少一個。',
        'name：繁體中文短名稱 4–10 字，例如「白色蕾絲細肩帶背心」「深藍直筒牛仔褲」，不要品牌名。',
      ].join('\n') },
    ] }],
    generationConfig: {
      thinkingConfig: { thinkingBudget: 0 }, temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: CATEGORIES.map((c) => c.id) },
          color: { type: 'STRING', enum: colors },
          seasons: { type: 'ARRAY', items: { type: 'STRING', enum: [...SEASONS] } },
          styles: { type: 'ARRAY', items: { type: 'STRING', enum: ['casual', 'formal', 'sport'] } },
          name: { type: 'STRING' },
        },
        required: ['category', 'color', 'seasons', 'styles', 'name'],
      },
    },
  }, signal);
  let j: Partial<GarmentJudgement>;
  try { j = JSON.parse(responseText(r)) as Partial<GarmentJudgement>; } catch { throw new Error('Gemini 的判斷結果格式看不懂'); }
  const category = CATEGORIES.some((c) => c.id === j.category) ? j.category! : 'tshirt';
  return {
    category,
    color: colors.includes(j.color as never) ? j.color! : '',
    seasons: [...new Set((j.seasons ?? []).filter((s) => (SEASONS as readonly string[]).includes(s)))] as Season[],
    styles: [...new Set((j.styles ?? []).filter((s) => ['casual', 'formal', 'sport'].includes(s)))],
    name: (j.name ?? '').trim().slice(0, 40),
  };
}
