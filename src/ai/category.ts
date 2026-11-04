/**
 * 衣服分類建議：ImageNet 分類結果 + 去背形狀分析。
 * ImageNet 沒有「襯衫」「短褲」等細類，所以用形狀補足：兩條褲管、長寬比、是否有袖子。
 * 只是「建議」，使用者可以改；信心不足時不自動選。
 */
import type { CategoryId } from '../lib/types';

/** ImageNet（不含 background 的 1000 類，0 起算）→ 衣櫥分類 */
export const IMAGENET_TO_CATEGORY: Record<number, CategoryId> = {
  610: 'tshirt', // jersey, T-shirt
  841: 'tshirt', // sweatshirt
  474: 'jacket', // cardigan
  834: 'jacket', // suit
  869: 'jacket', // trench coat
  568: 'jacket', // fur coat
  617: 'jacket', // lab coat
  652: 'jacket', // military uniform
  735: 'jacket', // poncho
  608: 'pants', // jean
  842: 'shorts', // swimming trunks
  655: 'skirt', // miniskirt
  601: 'skirt', // hoopskirt
  689: 'skirt', // overskirt
  775: 'skirt', // sarong
  578: 'dress', // gown
  399: 'dress', // abaya
  614: 'dress', // kimono
  502: 'shoes', // clog
  514: 'shoes', // cowboy boot
  630: 'shoes', // loafer
  770: 'shoes', // running shoe
  774: 'shoes', // sandal
  515: 'hat', // cowboy hat
  808: 'hat', // sombrero
  452: 'hat', // bonnet
  414: 'bag', // backpack
  748: 'bag', // purse
  636: 'bag', // mailbag
  893: 'bag', // wallet
  457: 'accessory', // bow tie
  451: 'accessory', // bolo tie
  836: 'accessory', // sunglass
  837: 'accessory', // sunglasses
  824: 'accessory', // stole（圍巾）
  806: 'accessory', // sock
  658: 'accessory', // mitten
};

export interface ShapeInfo {
  /** 高 / 寬 */
  aspect: number;
  /** 下半部中線是透明的（兩條褲管） */
  twoLegs: boolean;
  /** 褲管分開處在整體高度的位置（0=頂、1=底） */
  legSplitAt: number | null;
  /** 上半部最寬處 / 中段寬度（有袖子的上衣通常 > 1.25） */
  shoulderSpread: number;
}

export function shapeOf(alpha: Uint8ClampedArray, w: number, h: number): ShapeInfo | null {
  const op = (x: number, y: number) => alpha[(y * w + x) * 4 + 3]! > 40;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (op(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0 || y1 - y0 < 10 || x1 - x0 < 10) return null;
  const bw = x1 - x0, bh = y1 - y0;
  const widthAt = (y: number) => { let a = -1, b = -1; for (let x = x0; x <= x1; x++) if (op(x, y)) { if (a < 0) a = x; b = x; } return a < 0 ? 0 : b - a; };
  // 中線（中央 6% 寬）在下半部是否透明
  const cx = Math.round((x0 + x1) / 2), half = Math.max(1, Math.round(bw * 0.03));
  let gapRows = 0, total = 0, firstGap: number | null = null;
  for (let y = Math.round(y0 + bh * 0.45); y <= y1 - 2; y += 2) {
    total++;
    let clear = true;
    for (let x = cx - half; x <= cx + half; x++) if (op(x, y)) { clear = false; break; }
    if (clear) { gapRows++; if (firstGap === null) firstGap = (y - y0) / bh; }
  }
  const twoLegs = total > 0 && gapRows / total > 0.55;
  let top = 0; for (let t = 0.05; t <= 0.4; t += 0.05) top = Math.max(top, widthAt(Math.round(y0 + bh * t)));
  let mid = 0, n = 0; for (let t = 0.55; t <= 0.8; t += 0.05) { mid += widthAt(Math.round(y0 + bh * t)); n++; }
  mid = mid / n || 1;
  return { aspect: bh / bw, twoLegs, legSplitAt: twoLegs ? firstGap : null, shoulderSpread: top / mid };
}

export interface CategorySuggestion { category: CategoryId; confidence: number; reason: string }

export function suggestCategory(top: { index: number; score: number }[], shape: ShapeInfo | null): CategorySuggestion | null {
  const score: Partial<Record<CategoryId, number>> = {};
  for (const t of top) { const c = IMAGENET_TO_CATEGORY[t.index]; if (c) score[c] = (score[c] ?? 0) + t.score; }
  const ranked = (Object.entries(score) as [CategoryId, number][]).sort((a, b) => b[1] - a[1]);
  let [cat, conf] = ranked[0] ?? [null, 0];
  let reason = cat ? 'AI 辨識' : '';

  if (shape?.twoLegs) {
    // 有兩條褲管：一定是褲子；長短由長寬比與褲管長度判斷
    const shortLegs = shape.aspect < 1.15 || (shape.legSplitAt !== null && shape.legSplitAt > 0.62);
    const pick: CategoryId = shortLegs ? 'shorts' : 'pants';
    if (cat !== 'pants' && cat !== 'shorts') { cat = pick; conf = Math.max(conf, 0.5); reason = '依形狀判斷（有兩條褲管）'; }
    else if (cat !== pick) { cat = pick; reason = `AI 辨識＋形狀（${shortLegs ? '褲管較短' : '褲管較長'}）`; }
  } else if (cat === 'pants' || cat === 'shorts') {
    // 沒有分開的褲管卻被判成褲子：信心打折
    conf *= 0.5;
  }
  if (!cat) return null;
  if (cat === 'tshirt' && shape && shape.aspect > 1.55 && shape.shoulderSpread < 1.15) { cat = 'dress'; reason = '依形狀判斷（長版、無明顯袖子）'; }
  return { category: cat, confidence: Math.min(1, conf), reason };
}
