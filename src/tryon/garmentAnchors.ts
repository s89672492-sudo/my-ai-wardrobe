/**
 * 由去背衣服圖的 alpha 自動偵測錨點（每種服裝不同）。
 * 座標皆為衣服圖像素；L/R 為「畫面」左右（平放正面照的畫面左側＝穿著者右側）。
 * 肩線偵測方法參考 pravoobi/try-on tryon-core autoAnchor.ts（MIT），
 * 另加入：以「中央連續段」排除攤開的袖子、袖口偵測與袖長分類、褲襠點。
 */
import type { CategoryId } from '../lib/types';
import type { P2 } from './tps';

export type TryOnKind = 'top' | 'outer' | 'dress' | 'pants' | 'shorts' | 'skirt';
export type SleeveKind = 'none' | 'short' | 'long';

export const KIND_OF: Partial<Record<CategoryId, TryOnKind>> = {
  tshirt: 'top', shirt: 'top', jacket: 'outer', dress: 'dress', pants: 'pants', shorts: 'shorts', skirt: 'skirt',
};
export const KIND_ZH: Record<TryOnKind, string> = { top: '上衣', outer: '外套', dress: '洋裝', pants: '長褲', shorts: '短褲', skirt: '裙子' };
export const isUpper = (k: TryOnKind) => k === 'top' || k === 'outer' || k === 'dress';

export interface UpperAnchors {
  kind: 'top' | 'outer' | 'dress';
  w: number; h: number;
  shoulderL: P2; shoulderR: P2; waistL: P2; waistR: P2; hemL: P2; hemR: P2;
  cuffL: P2 | null; cuffR: P2 | null;
  sleeve: SleeveKind;
  /** 衣身中心 x */
  cx: number;
}
export interface LowerAnchors {
  kind: 'pants' | 'shorts' | 'skirt';
  w: number; h: number;
  bandL: P2; bandR: P2; hemL: P2; hemR: P2;
  /** 褲襠（兩褲管分開處），裙子為 null */
  crotch: P2 | null;
  cx: number;
}
export type GarmentAnchors = UpperAnchors | LowerAnchors;

const THR = 40;
type Row = { min: number; max: number } | null;

function rowsOf(a: Uint8ClampedArray, w: number, h: number): Row[] {
  const rows: Row[] = new Array(h).fill(null);
  for (let y = 0; y < h; y++) {
    let min = -1, max = -1;
    for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3]! > THR) { if (min < 0) min = x; max = x; }
    if (min >= 0) rows[y] = { min, max };
  }
  return rows;
}

/** 從 cx 往左右延伸的連續不透明段（排除與衣身分開的袖子） */
function centralSegment(a: Uint8ClampedArray, w: number, y: number, cx: number): Row {
  const op = (x: number) => a[(y * w + x) * 4 + 3]! > THR;
  let c = Math.round(cx);
  if (!op(c)) {
    let found = -1;
    for (let d = 1; d < w * 0.15 && found < 0; d++) { if (c - d >= 0 && op(c - d)) found = c - d; else if (c + d < w && op(c + d)) found = c + d; }
    if (found < 0) return null;
    c = found;
  }
  let l = c, r = c;
  while (l > 0 && op(l - 1)) l--;
  while (r < w - 1 && op(r + 1)) r++;
  return { min: l, max: r };
}

const median = (v: number[]) => { const s = [...v].sort((x, y) => x - y); return s.length ? s[s.length >> 1]! : 0; };

export function detectAnchors(alpha: Uint8ClampedArray, w: number, h: number, kind: TryOnKind): GarmentAnchors | null {
  const rows = rowsOf(alpha, w, h);
  let y0 = -1, y1 = -1;
  for (let y = 0; y < h; y++) if (rows[y]) { if (y0 < 0) y0 = y; y1 = y; }
  if (y0 < 0 || y1 - y0 < 10) return null;
  const H = y1 - y0;
  const yAt = (t: number) => Math.round(y0 + H * t);
  const bandAvg = (from: number, to: number, seg: (y: number) => Row | undefined) => {
    let l = 0, r = 0, n = 0;
    for (let y = from; y <= to; y++) { const s = seg(y); if (s) { l += s.min; r += s.max; n++; } }
    return n ? { min: l / n, max: r / n } : null;
  };

  if (kind === 'pants' || kind === 'shorts' || kind === 'skirt') {
    // 腰頭：衣服最上緣。用上方 4% 的中位寬度當基準，取第一列達 90% 的位置，
    // 避開去背殘留的細邊（不能取「最寬列」：裙子、牛仔褲最寬處在臀部，會把腰頭拉到胸下）
    const topW = median(Array.from({ length: Math.max(1, yAt(0.04) - y0 + 1) }, (_, i) => rows[y0 + i]).filter(Boolean).map((r) => r!.max - r!.min));
    let by = y0;
    for (let y = y0; y <= yAt(0.15); y++) { const r = rows[y]; if (r && r.max - r.min >= topW * 0.9) { by = y; break; } }
    const band = rows[by]!;
    const cx = (band.min + band.max) / 2;
    const hem = bandAvg(yAt(0.95), y1, (y) => rows[y])!;
    let crotch: P2 | null = null;
    if (kind !== 'skirt') {
      // 褲襠：腰頭以下，中線第一次出現透明的位置
      for (let y = by + Math.round(H * 0.08); y < yAt(0.9); y++) {
        let gap = true;
        for (let dx = -2; dx <= 2; dx++) if (alpha[(y * w + Math.round(cx) + dx) * 4 + 3]! > THR) { gap = false; break; }
        if (gap) { crotch = [cx, y]; break; }
      }
      if (!crotch) crotch = [cx, by + H * (kind === 'shorts' ? 0.55 : 0.3)];
    }
    return { kind, w, h, bandL: [band.min, by], bandR: [band.max, by], hemL: [hem.min, y1], hemR: [hem.max, y1], crotch, cx };
  }

  // ---- 上衣 / 外套 / 洋裝 ----
  // 衣身中心與寬度：取中段的「中央連續段」，排除攤開或分離的袖子
  let cx = 0;
  { const ys: number[] = []; for (let y = yAt(0.4); y <= yAt(0.8); y++) { const r = rows[y]; if (r) ys.push((r.min + r.max) / 2); } cx = median(ys) || w / 2; }
  const bodyFrom = kind === 'dress' ? 0.22 : 0.4, bodyTo = kind === 'dress' ? 0.42 : 0.85;
  const segs: Row[] = [];
  for (let y = yAt(bodyFrom); y <= yAt(bodyTo); y++) segs.push(centralSegment(alpha, w, y, cx));
  const valid = segs.filter(Boolean) as { min: number; max: number }[];
  if (!valid.length) return null;
  cx = median(valid.map((s) => (s.min + s.max) / 2));
  let bodyW = median(valid.map((s) => s.max - s.min));
  if (kind !== 'dress') {
    // 長袖平放時常貼著衣身；下襬附近袖子已結束，衣身寬取兩者較小值
    const hemSegs: number[] = [];
    for (let y = yAt(0.93); y <= yAt(0.99); y++) { const sg = centralSegment(alpha, w, y, cx); if (sg) hemSegs.push(sg.max - sg.min); }
    const hemW = median(hemSegs);
    if (hemW > 0 && hemW < bodyW) bodyW = hemW;
  }

  // 肩線：由上往下，第一列寬度達衣身寬 95%（領口、斜肩已展開到衣身寬）。
  // bodyW 已排除袖子，所以門檻要接近 100%，否則會落在領口斜肩上、肩寬偏窄
  let sy = y0;
  for (let y = y0; y <= yAt(0.4); y++) { const r = rows[y]; if (r && r.max - r.min >= bodyW * 0.95) { sy = y; break; } }
  const sr = rows[sy]!;
  const shoulderL: P2 = [Math.max(sr.min, cx - bodyW / 2), sy];
  const shoulderR: P2 = [Math.min(sr.max, cx + bodyW / 2), sy];

  // 下襬：上衣用中央段（排除垂到下襬的長袖袖口），洋裝用整列
  const hem = bandAvg(yAt(0.95), y1, (y) => (kind === 'dress' ? rows[y] : centralSegment(alpha, w, y, cx))) ?? { min: cx - bodyW / 2, max: cx + bodyW / 2 };

  // 腰線：洋裝找收腰最窄處，上衣取肩到下襬 55%
  let wy = Math.round(sy + (y1 - sy) * 0.55);
  if (kind === 'dress') {
    let best = Infinity;
    for (let y = Math.round(sy + (y1 - sy) * 0.15); y <= Math.round(sy + (y1 - sy) * 0.5); y++) {
      const s = centralSegment(alpha, w, y, cx);
      if (s && s.max - s.min < best) { best = s.max - s.min; wy = y; }
    }
    if (best > bodyW * 0.95) wy = Math.round(sy + (y1 - sy) * 0.3);
  }
  const ws0 = centralSegment(alpha, w, wy, cx) ?? { min: cx - bodyW / 2, max: cx + bodyW / 2 };
  // 腰線若和貼身的袖子連在一起，限制在衣身寬度附近
  const ws = { min: Math.max(ws0.min, cx - bodyW * 0.6), max: Math.min(ws0.max, cx + bodyW * 0.6) };

  // 袖子：肩線到下襬之間，左右最外側的點；取最外側中最低的一點當袖口
  let minX = Infinity, maxX = -Infinity, minY = sy, maxY = sy;
  for (let y = sy; y <= yAt(0.97); y++) {
    const r = rows[y];
    if (!r) continue;
    if (r.min <= minX) { if (r.min < minX - 1 || y > minY) minY = y; minX = Math.min(minX, r.min); }
    if (r.max >= maxX) { if (r.max > maxX + 1 || y > maxY) maxY = y; maxX = Math.max(maxX, r.max); }
  }
  const torsoLen = Math.max(1, y1 - sy);
  const spanL = shoulderL[0] - minX, spanR = maxX - shoulderR[0];
  let sleeve: SleeveKind = 'none';
  let cuffL: P2 | null = null, cuffR: P2 | null = null;
  if (Math.min(spanL, spanR) > bodyW * 0.06) {
    cuffL = [minX, minY]; cuffR = [maxX, maxY];
    const len = (Math.hypot(cuffL[0] - shoulderL[0], cuffL[1] - shoulderL[1]) + Math.hypot(cuffR[0] - shoulderR[0], cuffR[1] - shoulderR[1])) / 2;
    sleeve = len / torsoLen < (kind === 'dress' ? 0.3 : 0.5) ? 'short' : 'long';
  }
  return {
    kind, w, h, cx, sleeve, cuffL, cuffR,
    shoulderL, shoulderR, waistL: [ws.min, wy], waistR: [ws.max, wy], hemL: [hem.min, y1], hemR: [hem.max, y1],
  };
}
