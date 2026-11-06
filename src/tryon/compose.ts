/**
 * 試穿合成（Canvas 2D）：
 *   人物照片 → 依圖層順序：變形衣服 → 裁切到身體範圍 → 挖掉在衣服前方的手臂 → 疊上
 * 有人體部位圖（頭髮／皮膚／衣服）時：頭髮蓋在上衣前、手臂遮擋用真實皮膚範圍、
 * 並把照片中原本衣服的明暗（皺褶、光線方向）與環境色調套到新衣服上。
 * 這是電腦視覺 + 圖像合成，不是生成式 AI：不會重建新衣服本身的布料皺褶或被遮住的部分。
 */
import { MIN_SCORE, WAIST_T, type BodyAnalysis, type Pt } from '../ai/body';
import { bodyLine, correspondences, type Adjust } from './bodyTargets';
import { isUpper, type GarmentAnchors, type TryOnKind } from './garmentAnchors';
import { drawWarped, TPS, type P2 } from './tps';

export interface Layer {
  id: string; image: HTMLCanvasElement | ImageBitmap; anchors: GarmentAnchors; adjust: Adjust;
  /** 繪製順序（由 outfit.planLayers 決定）；未指定則依服裝種類 */
  z?: number;
  /** 在身體軸向 t 以下裁掉（上衣紮進下身） */
  cutBelowT?: number | null;
  /** 外套敞開 */
  openFront?: boolean;
}
export interface ComposeInput {
  photo: HTMLCanvasElement;
  mask: HTMLCanvasElement | null;
  /** 人體部位圖（R=頭髮、G=皮膚、B=衣服；範圍同 analysis.maskRect）；舊資料沒有 */
  parse?: HTMLCanvasElement | null;
  /** 光影融合強度 0~1（預設 0.6） */
  shading?: number;
  /** 擦掉新衣服沒蓋到、露出來的舊衣服（需要部位圖；預設開啟） */
  eraseOld?: boolean;
  analysis: BodyAnalysis;
  layers: Layer[];
  /** 拖曳中用較粗的網格加速 */
  draft?: boolean;
  /** 依運算模式的網格（未指定用預設） */
  grid?: { cols: number; rows: number };
  draftGrid?: { cols: number; rows: number };
  showAnchors?: boolean;
}
export interface ComposeOutput { canvas: HTMLCanvasElement; notes: string[]; ms: number; anchors: { id: string; dst: P2[]; labels: string[] }[]; /** 各階段耗時（ms） */ stages: Record<'mask' | 'warp' | 'clip' | 'occlude' | 'blend', number> }

/** 由下往上的圖層順序（Phase 5 會擴充多件組合） */
export const Z: Record<TryOnKind, number> = { pants: 10, shorts: 10, skirt: 12, top: 20, dress: 20, outer: 30 };

/**
 * 可在主執行緒或 Worker 執行：Worker 內沒有 document，改用 OffscreenCanvas（API 相容，型別沿用 HTMLCanvasElement）。
 */
const inWorker = typeof document === 'undefined';
function canvas(w: number, h: number): HTMLCanvasElement {
  if (inWorker) return new OffscreenCanvas(Math.max(1, w), Math.max(1, h)) as unknown as HTMLCanvasElement;
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

/**
 * 效能：遮罩、裁切範圍、手臂遮擋只和「人物照片 + 服裝種類」有關，和拖曳位置無關，
 * 以人體分析物件為 key 快取，拖曳調整時不必每一格重算（實測佔合成時間大半）。
 * WeakMap：換照片或離開頁面後自動被回收。
 */
const staticCache = new WeakMap<object, Map<string, HTMLCanvasElement | null>>();
function cached(owner: object, key: string, make: () => HTMLCanvasElement | null): HTMLCanvasElement | null {
  let m = staticCache.get(owner);
  if (!m) { m = new Map(); staticCache.set(owner, m); }
  if (!m.has(key)) m.set(key, make());
  return m.get(key)!;
}

/** 重複使用的暫存畫布（避免每格配置新的全尺寸畫布；iOS 對畫布總記憶體有上限） */
const pool: HTMLCanvasElement[] = [];
function scratch(w: number, h: number) {
  const c = pool.pop() ?? canvas(w, h);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else ctx(c).clearRect(0, 0, w, h);
  const x = ctx(c); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  return c;
}
function recycle(c: HTMLCanvasElement) { if (pool.length < 4) pool.push(c); else { c.width = 0; c.height = 0; } }
/** 釋放暫存畫布記憶體（離開試穿頁時呼叫） */
export function releaseComposeMemory() { for (const c of pool.splice(0)) { c.width = 0; c.height = 0; } }
function ctx(c: HTMLCanvasElement) { const x = c.getContext('2d'); if (!x) throw new Error('瀏覽器無法建立繪圖區（記憶體可能不足）'); return x; }

/** 人體遮罩放大到照片尺寸；dilate>0 時向外擴張（讓衣服邊緣貼齊輪廓而不留縫） */
function personMask(inp: ComposeInput, dilate: number): HTMLCanvasElement {
  const { photo, mask, analysis } = inp;
  const c = canvas(photo.width, photo.height), x = ctx(c);
  if (!mask) { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); return c; }
  const r = analysis.maskRect;
  x.imageSmoothingQuality = 'high';
  const offs = dilate > 0 ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]] : [[0, 0]];
  for (const [ox, oy] of offs) x.drawImage(mask, r.x + ox! * dilate, r.y + oy! * dilate, r.w, r.h);
  return c;
}

/** 需要保留在衣服前面的手臂（膠囊形），依衣服袖長與手臂狀態決定 */
function armOccluder(inp: ComposeInput, kind: TryOnKind, sleeve: 'none' | 'short' | 'long', personRaw: HTMLCanvasElement): HTMLCanvasElement | null {
  const a = inp.analysis, K = a.keypoints, ok = (i: number) => K[i]!.score >= MIN_SCORE;
  const shW = Math.hypot(K[5]!.x - K[6]!.x, K[5]!.y - K[6]!.y);
  const r = Math.max(4, shW * 0.14);
  const segs: { a: Pt; b: Pt; r: number }[] = [];
  for (const [s, e, w, side] of [[5, 7, 9, 'left'], [6, 8, 10, 'right']] as const) {
    const st = a.arms[side];
    const inFront = st === 'front' || st === 'akimbo';
    if (!ok(s) || !ok(e)) continue;
    const forearm = isUpper(kind) ? sleeve !== 'long' || inFront : true;
    const upperArm = isUpper(kind) ? sleeve === 'none' : false;
    if (upperArm) segs.push({ a: { x: K[s]!.x + (K[e]!.x - K[s]!.x) * 0.3, y: K[s]!.y + (K[e]!.y - K[s]!.y) * 0.3 }, b: K[e]!, r });
    if (forearm && ok(w)) {
      // 前臂 + 手掌（手腕再往外延伸一段）
      const hand = { x: K[w]!.x + (K[w]!.x - K[e]!.x) * 0.3, y: K[w]!.y + (K[w]!.y - K[e]!.y) * 0.3 };
      segs.push({ a: K[e]!, b: hand, r: r * 0.85 });
    }
  }
  if (!segs.length) return null;
  // 以半解析度繪製再放大，邊緣自然柔化
  const W = inp.photo.width, H = inp.photo.height, k = 0.5;
  const lo = canvas(Math.ceil(W * k), Math.ceil(H * k)), lx = ctx(lo);
  lx.lineCap = 'round'; lx.strokeStyle = '#000';
  for (const sg of segs) { lx.lineWidth = sg.r * 2 * k; lx.beginPath(); lx.moveTo(sg.a.x * k, sg.a.y * k); lx.lineTo(sg.b.x * k, sg.b.y * k); lx.stroke(); }
  const out = canvas(W, H), ox = ctx(out);
  ox.imageSmoothingQuality = 'high';
  ox.drawImage(lo, 0, 0, W, H);
  ox.globalCompositeOperation = 'destination-in';
  ox.drawImage(personRaw, 0, 0); // 只保留真的是人體的像素
  return out;
}

/** 部位圖放大到照片尺寸，拆成三張遮罩（白色 + alpha）：頭髮、皮膚、衣服 */
function parseMasks(inp: ComposeInput) {
  const { photo, parse, analysis } = inp;
  if (!parse) return null;
  const W = photo.width, H = photo.height, r = analysis.maskRect;
  const big = canvas(W, H), bx = ctx(big);
  bx.imageSmoothingQuality = 'high';
  bx.drawImage(parse, r.x, r.y, r.w, r.h);
  const src = bx.getImageData(0, 0, W, H).data;
  const make = (ch: number) => {
    const c = canvas(W, H), x = ctx(c), d = x.createImageData(W, H), px = d.data;
    for (let i = 0; i < px.length; i += 4) { px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = src[i + ch]!; }
    x.putImageData(d, 0, 0);
    return c;
  };
  // 部位圖範圍外（maskRect 以外）沒有資料：getImageData 為 0，自然不會誤判
  return { hair: make(0), skin: make(1), clothes: make(2) };
}

/** 手臂遮擋區域（膠囊形）。widen>1 時放寬，用來與真實皮膚取交集 */
function armCapsules(inp: ComposeInput, kind: TryOnKind, sleeve: 'none' | 'short' | 'long', widen = 1) {
  const a = inp.analysis, K = a.keypoints, ok = (i: number) => K[i]!.score >= MIN_SCORE;
  const shW = Math.hypot(K[5]!.x - K[6]!.x, K[5]!.y - K[6]!.y);
  const r = Math.max(4, shW * 0.14) * widen;
  const segs: { a: Pt; b: Pt; r: number }[] = [];
  for (const [s, e, w, side] of [[5, 7, 9, 'left'], [6, 8, 10, 'right']] as const) {
    const st = a.arms[side];
    const inFront = st === 'front' || st === 'akimbo';
    if (!ok(s) || !ok(e)) continue;
    const forearm = isUpper(kind) ? sleeve !== 'long' || inFront : true;
    const upperArm = isUpper(kind) ? sleeve === 'none' : false;
    if (upperArm) segs.push({ a: { x: K[s]!.x + (K[e]!.x - K[s]!.x) * 0.3, y: K[s]!.y + (K[e]!.y - K[s]!.y) * 0.3 }, b: K[e]!, r });
    if (forearm && ok(w)) {
      const hand = { x: K[w]!.x + (K[w]!.x - K[e]!.x) * 0.3 * widen, y: K[w]!.y + (K[w]!.y - K[e]!.y) * 0.3 * widen };
      // 放寬時起點往手腕方向移，圓頭才不會越過手肘吃到袖子
      const t0 = widen > 1 ? Math.min(0.45, (r * 0.85) / Math.max(1, Math.hypot(K[w]!.x - K[e]!.x, K[w]!.y - K[e]!.y))) : 0;
      const start = { x: K[e]!.x + (K[w]!.x - K[e]!.x) * t0, y: K[e]!.y + (K[w]!.y - K[e]!.y) * t0 };
      segs.push({ a: start, b: hand, r: r * 0.85 });
    }
  }
  return segs;
}
function strokeCapsules(W: number, H: number, segs: { a: Pt; b: Pt; r: number }[]) {
  const k = 0.5;
  const lo = canvas(Math.ceil(W * k), Math.ceil(H * k)), lx = ctx(lo);
  lx.lineCap = 'round'; lx.strokeStyle = '#000';
  for (const sg of segs) { lx.lineWidth = sg.r * 2 * k; lx.beginPath(); lx.moveTo(sg.a.x * k, sg.a.y * k); lx.lineTo(sg.b.x * k, sg.b.y * k); lx.stroke(); }
  const out = canvas(W, H), ox = ctx(out);
  ox.imageSmoothingQuality = 'high';
  ox.drawImage(lo, 0, 0, W, H);
  return out;
}
function alphaSum(c: HTMLCanvasElement) {
  // 以 1/8 解析度估算不透明像素量
  const s = canvas(Math.max(1, c.width >> 3), Math.max(1, c.height >> 3)), x = ctx(s);
  x.drawImage(c, 0, 0, s.width, s.height);
  const d = x.getImageData(0, 0, s.width, s.height).data;
  let t = 0; for (let i = 3; i < d.length; i += 4) t += d[i]!;
  return t;
}

/**
 * 有部位圖時的手臂遮擋：在放寬的手臂範圍內，只保留「真的是皮膚」的像素（邊緣精準，不會帶到旁邊的舊衣服）。
 * 若原照片的手臂被長袖蓋住（範圍內皮膚很少），退回原本的膠囊形遮擋。
 */
function armOccluderParsed(inp: ComposeInput, kind: TryOnKind, sleeve: 'none' | 'short' | 'long', personRaw: HTMLCanvasElement, skin: HTMLCanvasElement) {
  const W = inp.photo.width, H = inp.photo.height;
  const narrowSegs = armCapsules(inp, kind, sleeve, 1);
  if (!narrowSegs.length) return null;
  const narrow = strokeCapsules(W, H, narrowSegs);
  const nx = ctx(narrow); nx.globalCompositeOperation = 'destination-in'; nx.drawImage(personRaw, 0, 0);
  const wide = strokeCapsules(W, H, armCapsules(inp, kind, sleeve, 1.6));
  const wx = ctx(wide); wx.globalCompositeOperation = 'destination-in'; wx.drawImage(skin, 0, 0);
  // 皮膚占窄範圍的比例：太低代表手臂穿著袖子，皮膚遮罩不可靠
  return alphaSum(wide) > alphaSum(narrow) * 0.4 ? wide : narrow;
}

/**
 * 光影圖（灰階，128＝不變）：照片的「局部明暗 / 大範圍照明」比值，保留皺褶與光線方向，
 * 去掉原本衣服的細紋路。原本是衣服的地方權重高，其他地方（皮膚、背景）權重低。
 */
function shadingMap(inp: ComposeInput, clothes: HTMLCanvasElement | null, raw: HTMLCanvasElement): HTMLCanvasElement {
  const { photo, analysis } = inp;
  const W = photo.width, H = photo.height;
  const k = 0.25; // 1/4 解析度計算，放大後自然平滑
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  const sm = canvas(w, h), sx = ctx(sm);
  sx.imageSmoothingQuality = 'high';
  sx.drawImage(photo, 0, 0, w, h);
  const px = sx.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h);
  for (let i = 0; i < L.length; i++) L[i] = (0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!) / 255 + 0.02;
  const shW = analysis.measures.shoulderWidth * k;
  const small = boxBlur(L, w, h, Math.max(1, Math.round(shW * 0.03)));
  const large = boxBlur(L, w, h, Math.max(2, Math.round(shW * 0.18)));
  // 權重：皺褶細節只取「原本是衣服」的地方（皮膚、背景的輪廓不能印到新衣服上）；
  // 大範圍照明（左右明暗）在整個人體範圍都套用，但較輕
  const readAlpha = (c: HTMLCanvasElement) => {
    const t = canvas(w, h), tx = ctx(t); tx.drawImage(c, 0, 0, w, h);
    const d = tx.getImageData(0, 0, w, h).data, a = new Float32Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3]! / 255;
    return a;
  };
  const person = readAlpha(raw);
  // 衣服區域往內縮一點：邊緣常混到手臂與背景
  const clothesW = clothes ? boxBlur(readAlpha(clothes), w, h, Math.max(1, Math.round(shW * 0.02))).map((v) => Math.max(0, Math.min(1, (v - 0.35) / 0.5))) : null;
  const out = sx.createImageData(w, h), o = out.data;
  for (let i = 0; i < L.length; i++) {
    // 細節（皺褶）+ 照明（左右明暗）；以對數空間混合避免過曝
    const detail = clothesW ? Math.log(small[i]! / large[i]!) * clothesW[i]! : 0;
    const light = Math.log(large[i]! / 0.5) * person[i]! * 0.3;
    const v = Math.max(-0.6, Math.min(0.5, detail * 0.9 + light));
    const g = Math.round(128 + v * 200);
    o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = Math.max(0, Math.min(255, g)); o[i * 4 + 3] = 255;
  }
  sx.putImageData(out, 0, 0);
  const big = canvas(W, H), bx = ctx(big);
  bx.imageSmoothingQuality = 'high';
  bx.drawImage(sm, 0, 0, W, H);
  return big;
}
/** 盒狀模糊（可分離，兩次） */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}
/** 環境色調：人物身上（皮膚＋衣服，不含背景）的平均色偏，讓白色衣服在暖光下也帶點暖色 */
function sceneTint(inp: ComposeInput, raw: HTMLCanvasElement): string {
  const { photo, analysis } = inp, r = analysis.maskRect;
  const s = canvas(24, 24), x = ctx(s);
  x.drawImage(photo, r.x, r.y, r.w, r.h, 0, 0, 24, 24);
  const d = x.getImageData(0, 0, 24, 24).data;
  const m2 = canvas(24, 24), mx = ctx(m2);
  mx.drawImage(raw, r.x, r.y, r.w, r.h, 0, 0, 24, 24);
  const md = mx.getImageData(0, 0, 24, 24).data;
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const w = md[i + 3]! / 255; R += d[i]! * w; G += d[i + 1]! * w; B += d[i + 2]! * w; n += w; }
  if (n < 1) return 'rgb(255,255,255)';
  // 只取色偏（不改整體亮度，亮度由光影圖處理）；膚色本身偏暖，所以只取一小部分
  const m = Math.max(R, G, B) || 1;
  const ch = (v: number) => Math.round(255 * (0.9 + 0.1 * (v / m)));
  return `rgb(${ch(R)},${ch(G)},${ch(B)})`;
}

/**
 * 推拉式補圖（pull-push）：已知像素逐層平均到低解析度，再由粗到細把未知像素補上（雙線性取樣）。
 * 只用「不是衣服」的像素（背景、皮膚）當來源，所以補出來的是背景或膚色，不會補成舊衣服。
 */
export function pullPush(rgb: Float32Array, wt: Float32Array, w: number, h: number) {
  type Lv = { w: number; h: number; c: Float32Array; a: Float32Array };
  const levels: Lv[] = [{ w, h, c: new Float32Array(rgb.length), a: new Float32Array(wt) }];
  for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) levels[0]!.c[i * 3 + k] = rgb[i * 3 + k]! * wt[i]!;
  while (levels.at(-1)!.w > 1 || levels.at(-1)!.h > 1) {
    const f = levels.at(-1)!, nw = Math.ceil(f.w / 2), nh = Math.ceil(f.h / 2);
    const c = new Float32Array(nw * nh * 3), a = new Float32Array(nw * nh);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x, j = (y >> 1) * nw + (x >> 1);
      a[j] = a[j]! + f.a[i]!; c[j * 3] = c[j * 3]! + f.c[i * 3]!; c[j * 3 + 1] = c[j * 3 + 1]! + f.c[i * 3 + 1]!; c[j * 3 + 2] = c[j * 3 + 2]! + f.c[i * 3 + 2]!;
    }
    for (let j = 0; j < nw * nh; j++) if (a[j]! > 1) { const s = 1 / a[j]!; a[j] = 1; c[j * 3]! *= s; c[j * 3 + 1]! *= s; c[j * 3 + 2]! *= s; }
    levels.push({ w: nw, h: nh, c, a });
  }
  // 由粗到細：未知（權重 < 1）的部分由上一層雙線性取樣補滿
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l]!, g = levels[l + 1]!;
    const sample = (x: number, y: number, k: number) => {
      const gx = Math.min(g.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), gy = Math.min(g.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1), fx = gx - x0, fy = gy - y0;
      const v = (xx: number, yy: number) => { const j = yy * g.w + xx; return g.a[j]! > 0 ? g.c[j * 3 + k]! / g.a[j]! : 0; };
      return (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
    };
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x, a = Math.min(1, f.a[i]!);
      if (a >= 1) continue;
      for (let k = 0; k < 3; k++) f.c[i * 3 + k] = f.c[i * 3 + k]! + (1 - a) * sample(x, y, k);
      f.a[i] = 1;
    }
  }
  const out = new Float32Array(w * h * 3), L0 = levels[0]!;
  for (let i = 0; i < w * h; i++) { const a = L0.a[i]! || 1; for (let k = 0; k < 3; k++) out[i * 3 + k] = L0.c[i * 3 + k]! / a; }
  return out;
}

/** 以 pull-push 補圖；known 為來源像素的遮罩（alpha），回傳放大到照片尺寸的畫布 */
function fillFrom(photo: HTMLCanvasElement, known: (i: number) => number, w: number, h: number, px: Uint8ClampedArray): HTMLCanvasElement {
  const rgb = new Float32Array(w * h * 3), wt = new Float32Array(w * h);
  let any = 0;
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = px[i * 4]!; rgb[i * 3 + 1] = px[i * 4 + 1]!; rgb[i * 3 + 2] = px[i * 4 + 2]!; wt[i] = known(i); any += wt[i]!; }
  if (any < 4) for (let i = 0; i < w * h; i++) wt[i] = 1; // 沒有可用來源：維持原圖
  const f = pullPush(rgb, wt, w, h);
  const sm = canvas(w, h), sx = ctx(sm), d = sx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { d.data[i * 4] = f[i * 3]!; d.data[i * 4 + 1] = f[i * 3 + 1]!; d.data[i * 4 + 2] = f[i * 3 + 2]!; d.data[i * 4 + 3] = 255; }
  sx.putImageData(d, 0, 0);
  const big = canvas(photo.width, photo.height), bx = ctx(big);
  bx.imageSmoothingQuality = 'high';
  bx.drawImage(sm, 0, 0, photo.width, photo.height);
  return big;
}

/**
 * 推估「衣服底下的身體」範圍（軀幹、脖子、手臂、腿），用關鍵點畫出。
 * 擦掉舊衣服後，身體範圍內補膚色、範圍外補背景（真實情況是手臂＋背景，而不是兩者混成的咖啡色）。
 */
function bodyShape(inp: ComposeInput, scale: number, widen = 1): HTMLCanvasElement {
  const { photo, analysis } = inp, K = analysis.keypoints, ok = (i: number) => K[i]!.score >= MIN_SCORE;
  const shW = analysis.measures.shoulderWidth;
  const c = canvas(Math.ceil(photo.width * scale), Math.ceil(photo.height * scale)), x = ctx(c);
  x.scale(scale, scale);
  x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineCap = 'round'; x.lineJoin = 'round';
  const line = (pts: number[], r: number) => {
    const ps = pts.filter(ok);
    if (ps.length < 2) return;
    x.lineWidth = r * 2 * widen; x.beginPath(); x.moveTo(K[ps[0]!]!.x, K[ps[0]!]!.y);
    for (const i of ps.slice(1)) x.lineTo(K[i]!.x, K[i]!.y);
    x.stroke();
  };
  if ([5, 6, 11, 12].every(ok)) {
    // 軀幹略內縮
    const cxm = (K[5]!.x + K[6]!.x + K[11]!.x + K[12]!.x) / 4, cym = (K[5]!.y + K[6]!.y + K[11]!.y + K[12]!.y) / 4;
    const p = (i: number) => [cxm + (K[i]!.x - cxm) * 0.92 * widen, cym + (K[i]!.y - cym) * 0.95] as const;
    x.beginPath(); x.moveTo(...p(5)); x.lineTo(...p(6)); x.lineTo(...p(12)); x.lineTo(...p(11)); x.closePath(); x.fill();
    // 脖子：肩膀中點往鼻子方向
    if (ok(0)) {
      const mx = (K[5]!.x + K[6]!.x) / 2, my = (K[5]!.y + K[6]!.y) / 2;
      x.lineWidth = shW * 0.32 * widen; x.beginPath(); x.moveTo(mx, my); x.lineTo(mx + (K[0]!.x - mx) * 0.6, my + (K[0]!.y - my) * 0.6); x.stroke();
    }
  }
  line([5, 7, 9], shW * 0.1);
  line([6, 8, 10], shW * 0.1);
  line([11, 13, 15], shW * 0.15);
  line([12, 14, 16], shW * 0.15);
  return c;
}

/** 整張照片中「舊衣服」都被補掉的版本：身體範圍補膚色、其他補背景（1/4 解析度計算後放大，柔和不帶紋路） */
function clothesFreePhoto(inp: ComposeInput, parts: NonNullable<ReturnType<typeof parseMasks>>, raw: HTMLCanvasElement): HTMLCanvasElement {
  const { photo } = inp;
  const W = photo.width, H = photo.height, k = 0.25;
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  const small = (c: HTMLCanvasElement, dil = 0) => {
    const t = canvas(w, h), tx = ctx(t);
    tx.imageSmoothingQuality = 'high';
    const offs = dil ? [[0, 0], [dil, 0], [-dil, 0], [0, dil], [0, -dil]] : [[0, 0]];
    for (const [ox, oy] of offs) tx.drawImage(c, ox!, oy!, w, h);
    return tx.getImageData(0, 0, w, h).data;
  };
  const px = small(photo);
  const clothes = small(parts.clothes, 1), skin = small(parts.skin), person = small(raw, 1);
  // 背景：不是人、不是衣服；皮膚：部位圖判定為皮膚
  const bg = fillFrom(photo, (i) => (person[i * 4 + 3]! < 60 && clothes[i * 4 + 3]! < 50 ? 1 : 0), w, h, px);
  const sk = fillFrom(photo, (i) => (skin[i * 4 + 3]! > 160 && clothes[i * 4 + 3]! < 50 ? 1 : 0), w, h, px);
  // 身體範圍以半解析度畫再放大，邊緣柔和
  const shape = bodyShape(inp, 0.5);
  const out = canvas(W, H), o = ctx(out);
  o.drawImage(bg, 0, 0);
  const t = canvas(W, H), tx = ctx(t);
  tx.drawImage(sk, 0, 0);
  tx.globalCompositeOperation = 'destination-in';
  tx.imageSmoothingQuality = 'high';
  tx.drawImage(shape, 0, 0, W, H);
  o.drawImage(t, 0, 0);
  return out;
}

/** 袖子可能出現的範圍：肩膀到手腕的寬膠囊（含寬袖） */
function sleeveZone(inp: ComposeInput): HTMLCanvasElement {
  const { photo, analysis } = inp, K = analysis.keypoints, ok = (i: number) => K[i]!.score >= MIN_SCORE;
  const shW = analysis.measures.shoulderWidth, k = 0.5;
  const c = canvas(Math.ceil(photo.width * k), Math.ceil(photo.height * k)), x = ctx(c);
  x.scale(k, k); x.strokeStyle = '#fff'; x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = shW * 0.55;
  for (const arm of [[5, 7, 9], [6, 8, 10]]) {
    const ps = arm.filter(ok);
    if (ps.length < 2) continue;
    x.beginPath(); x.moveTo(K[ps[0]!]!.x, K[ps[0]!]!.y);
    for (const i of ps.slice(1)) x.lineTo(K[i]!.x, K[i]!.y);
    x.stroke();
  }
  return c;
}

/**
 * 要擦掉的舊衣服範圍（依試穿的衣服種類）：
 * 上衣／外套 → 腰線以上；褲子／裙子 → 腰線以下；洋裝或上下都有 → 全部。
 * 敞開的外套且沒有新上衣時不擦上半身（開口要看得到原本的上衣）。
 */
function eraseZone(layers: Layer[]): { upper: boolean; lower: boolean } {
  const kinds = layers.map((l) => l.anchors.kind);
  const hasTop = kinds.some((k) => k === 'top' || k === 'dress');
  const outerOpen = layers.some((l) => l.anchors.kind === 'outer' && l.openFront);
  const upper = hasTop || (kinds.includes('outer') && !outerOpen);
  const lower = kinds.some((k) => k === 'pants' || k === 'shorts' || k === 'skirt' || k === 'dress');
  return { upper, lower };
}

/** 以身體軸向的一條線切半平面（below = 往身體下方那一側） */
function halfPlane(x: CanvasRenderingContext2D, line: { p: P2; across: P2 }, side: 'below' | 'above', size: number, op: GlobalCompositeOperation) {
  const { p, across } = line, f = size * 2, s = side === 'below' ? 1 : -1;
  // 身體往下的方向 = across 旋轉 +90°
  const dn: P2 = [-across[1] * s, across[0] * s];
  x.save();
  x.globalCompositeOperation = op;
  x.fillStyle = '#fff';
  x.beginPath();
  x.moveTo(p[0] - across[0] * f, p[1] - across[1] * f);
  x.lineTo(p[0] + across[0] * f, p[1] + across[1] * f);
  x.lineTo(p[0] + across[0] * f + dn[0] * f, p[1] + across[1] * f + dn[1] * f);
  x.lineTo(p[0] - across[0] * f + dn[0] * f, p[1] - across[1] * f + dn[1] * f);
  x.closePath(); x.fill();
  x.restore();
}

const openCache = new WeakMap<object, HTMLCanvasElement>();
const parseCache = new WeakMap<HTMLCanvasElement, NonNullable<ReturnType<typeof parseMasks>>>();
const sceneTintCache = new WeakMap<object, string>();
/** 外套敞開：在衣服圖上挖掉前襟（由領口往下漸寬的梯形），再進行變形，所以開口會跟著身體 */
function openFrontImage(img: HTMLCanvasElement | ImageBitmap, g: Extract<GarmentAnchors, { cuffL: unknown }>): HTMLCanvasElement {
  const hit = openCache.get(img);
  if (hit) return hit;
  const c = canvas(img.width, img.height), x = ctx(c);
  x.drawImage(img, 0, 0);
  const shW = g.shoulderR[0] - g.shoulderL[0], hemW = g.hemR[0] - g.hemL[0];
  x.globalCompositeOperation = 'destination-out';
  x.beginPath();
  x.moveTo(g.cx - shW * 0.07, 0); x.lineTo(g.cx + shW * 0.07, 0);
  x.lineTo(g.cx + shW * 0.09, g.shoulderL[1] + (g.hemL[1] - g.shoulderL[1]) * 0.25);
  x.lineTo(g.cx + hemW * 0.13, img.height); x.lineTo(g.cx - hemW * 0.13, img.height);
  x.lineTo(g.cx - shW * 0.09, g.shoulderL[1] + (g.hemL[1] - g.shoulderL[1]) * 0.25);
  x.closePath(); x.fill();
  openCache.set(img, c);
  return c;
}

export function composeTryOn(inp: ComposeInput): ComposeOutput {
  const t0 = performance.now();
  const { photo, analysis } = inp;
  const W = photo.width, H = photo.height;
  const out = canvas(W, H), o = ctx(out);
  o.drawImage(photo, 0, 0);
  const notes: string[] = [];
  const anchors: ComposeOutput['anchors'] = [];
  const shW = analysis.measures.shoulderWidth;
  const stages = { mask: 0, warp: 0, clip: 0, occlude: 0, blend: 0 };
  let ts = performance.now();
  const lap = (k: keyof typeof stages) => { const n = performance.now(); stages[k] += n - ts; ts = n; };
  const owner = analysis as object;
  const mk = `${W}x${H}`;
  const raw = cached(owner, `raw|${mk}`, () => personMask(inp, 0))!;
  const dilated = cached(owner, `dil|${mk}`, () => personMask(inp, Math.max(2, shW * 0.03)))!;
  // 部位圖相關快取以部位圖畫布為 key（重新辨識後自動失效）
  const pOwner = (inp.parse ?? owner) as object;
  const parts = inp.parse ? parseCache.get(inp.parse) ?? (parseCache.set(inp.parse, parseMasks(inp)!), parseCache.get(inp.parse)!) : null;
  const hairFront = parts ? cached(pOwner, `hair|${mk}`, () => {
    // 只取腰線以上的頭髮（避免深色布料被誤判為頭髮）
    const c = canvas(W, H), x = ctx(c);
    x.drawImage(parts.hair, 0, 0);
    halfPlane(x, bodyLine(analysis, 0.5), 'below', W + H, 'destination-out');
    return c;
  }) : null;
  const strength = Math.max(0, Math.min(1, inp.shading ?? 0.6));
  const shade = strength > 0 ? cached(pOwner, `shade|${mk}`, () => shadingMap(inp, parts?.clothes ?? null, raw)) : null;
  const tint = strength > 0 ? sceneTintCache.get(owner) ?? (sceneTintCache.set(owner, sceneTint(inp, raw)), sceneTintCache.get(owner)!) : null;
  lap('mask');

  const layers = [...inp.layers].sort((a, b) => (a.z ?? Z[a.anchors.kind]) - (b.z ?? Z[b.anchors.kind]));
  // 擦掉露出來的舊衣服：在新衣服之下先鋪一層「舊衣服被補掉」的照片（只在對應範圍）
  if (parts && inp.eraseOld !== false && layers.length) {
    const z = eraseZone(layers);
    if (z.upper || z.lower) {
      const erase = cached(pOwner, `erase|${mk}|${z.upper}|${z.lower}`, () => {
        const fill = cached(pOwner, `fill|${mk}`, () => clothesFreePhoto(inp, parts, raw))!;
        const c = canvas(W, H), x = ctx(c);
        x.drawImage(fill, 0, 0);
        const m = canvas(W, H), mx = ctx(m);
        const d = Math.max(1, shW * 0.012);
        for (const [ox, oy] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]]) mx.drawImage(parts.clothes, ox!, oy!);
        if (!(z.upper && z.lower)) {
          // 範圍：上衣＝腰線以上＋整條手臂附近（袖子屬於上衣）；下身＝腰線以下、但不含手臂附近
          const zone = canvas(W, H), zx = ctx(zone);
          halfPlane(zx, bodyLine(analysis, WAIST_T), z.upper ? 'above' : 'below', W + H, 'source-over');
          const arms = sleeveZone(inp);
          zx.globalCompositeOperation = z.upper ? 'source-over' : 'destination-out';
          zx.drawImage(arms, 0, 0, W, H);
          mx.globalCompositeOperation = 'destination-in';
          mx.drawImage(zone, 0, 0);
        }
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(m, 0, 0);
        return c;
      })!;
      o.drawImage(erase, 0, 0);
    }
  }
  for (const L of layers) {
    const g = L.anchors;
    const corr = correspondences(g, analysis, L.adjust);
    notes.push(...corr.notes);
    let tps: TPS;
    try { tps = new TPS(corr.src, corr.dst); } catch (e) { notes.push(`無法變形：${(e as Error).message}`); continue; }
    lap('blend');
    const layer = scratch(W, H), lx = ctx(layer);
    lx.imageSmoothingQuality = 'high';
    drawWarped(lx, L.openFront && 'cuffL' in g ? openFrontImage(L.image, g) : L.image, tps, inp.draft ? (inp.draftGrid ?? { cols: 8, rows: 12 }) : (inp.grid ?? { cols: 18, rows: 26 }));

    lap('warp');
    // 裁切：衣服只出現在身體範圍；洋裝與裙子的下襬（臀線以下）可以超出腿部
    const clip = cached(owner, `clip|${mk}|${g.kind}|${L.cutBelowT ?? ''}`, () => {
      const c = canvas(W, H), cx = ctx(c);
      cx.drawImage(dilated, 0, 0);
      if (g.kind === 'dress' || g.kind === 'skirt') halfPlane(cx, bodyLine(analysis, 0.92), 'below', W + H, 'source-over');
      // 上衣不畫到肩線上方太高（領子背面會蓋住脖子與下巴）
      if (isUpper(g.kind)) halfPlane(cx, bodyLine(analysis, -0.06), 'above', W + H, 'destination-out');
      // 上衣紮進下身：腰頭以下裁掉
      if (L.cutBelowT != null) halfPlane(cx, bodyLine(analysis, L.cutBelowT), 'below', W + H, 'destination-out');
      return c;
    })!;
    lx.globalCompositeOperation = 'destination-in';
    lx.drawImage(clip, 0, 0);

    lap('clip');
    // 前景遮擋：在衣服前方的手臂與手
    const sleeve = 'sleeve' in g ? g.sleeve : 'none';
    const occ = parts
      ? cached(pOwner, `occp|${mk}|${g.kind}|${sleeve}`, () => armOccluderParsed(inp, g.kind, sleeve, raw, parts.skin))
      : cached(owner, `occ|${mk}|${g.kind}|${sleeve}`, () => armOccluder(inp, g.kind, sleeve, raw));
    if (occ) { lx.globalCompositeOperation = 'destination-out'; lx.drawImage(occ, 0, 0); }
    // 頭髮蓋在上衣前面（長髮垂在肩上）
    if (hairFront && isUpper(g.kind)) { lx.globalCompositeOperation = 'destination-out'; lx.drawImage(hairFront, 0, 0); }
    lx.globalCompositeOperation = 'source-over';
    lap('occlude');
    // 光影融合：環境色調（multiply）+ 原照片的明暗皺褶（soft-light），最後還原衣服的透明度
    if (shade && tint) {
      const keep = scratch(W, H), kx = ctx(keep);
      kx.drawImage(layer, 0, 0);
      lx.globalAlpha = strength;
      lx.globalCompositeOperation = 'multiply'; lx.fillStyle = tint; lx.fillRect(0, 0, W, H);
      lx.globalAlpha = Math.min(1, strength * 1.4);
      lx.globalCompositeOperation = 'soft-light'; lx.drawImage(shade, 0, 0);
      lx.globalAlpha = 1;
      lx.globalCompositeOperation = 'destination-in'; lx.drawImage(keep, 0, 0);
      lx.globalCompositeOperation = 'source-over';
      recycle(keep);
    }
    o.drawImage(layer, 0, 0);
    recycle(layer);
    anchors.push({ id: L.id, dst: corr.dst, labels: corr.labels });
  }

  if (inp.showAnchors) {
    const u = Math.max(1, W / 500);
    o.font = `600 ${11 * u}px -apple-system, sans-serif`;
    for (const a of anchors) a.dst.forEach(([x, y], i) => {
      o.fillStyle = '#fff'; o.beginPath(); o.arc(x, y, 6 * u, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#ff2d55'; o.beginPath(); o.arc(x, y, 4 * u, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#111'; o.fillText(a.labels[i] ?? '', x + 7 * u, y - 5 * u);
    });
  }
  lap('blend');
  return { canvas: out, notes: [...new Set(notes)], ms: performance.now() - t0, anchors, stages };
}
