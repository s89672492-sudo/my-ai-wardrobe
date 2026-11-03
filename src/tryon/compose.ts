/**
 * 試穿合成（Canvas 2D）：
 *   人物照片 → 依圖層順序：變形衣服 → 裁切到身體範圍 → 挖掉在衣服前方的手臂 → 疊上
 * 這是電腦視覺 + 圖像合成，不是生成式 AI；布料皺褶、光影、合身度都不會重建。
 */
import { MIN_SCORE, type BodyAnalysis, type Pt } from '../ai/body';
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

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

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
  const c = pool.pop() ?? document.createElement('canvas');
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
  lap('mask');

  const layers = [...inp.layers].sort((a, b) => (a.z ?? Z[a.anchors.kind]) - (b.z ?? Z[b.anchors.kind]));
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
    const occ = cached(owner, `occ|${mk}|${g.kind}|${sleeve}`, () => armOccluder(inp, g.kind, sleeve, raw));
    if (occ) { lx.globalCompositeOperation = 'destination-out'; lx.drawImage(occ, 0, 0); }
    lx.globalCompositeOperation = 'source-over';
    lap('occlude');
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
