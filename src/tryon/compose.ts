/**
 * 試穿合成（Canvas 2D）：
 *   人物照片 → 依圖層順序：變形衣服 → 裁切到身體範圍 → 挖掉在衣服前方的手臂 → 疊上
 * 這是電腦視覺 + 圖像合成，不是生成式 AI；布料皺褶、光影、合身度都不會重建。
 */
import { MIN_SCORE, type BodyAnalysis, type Pt } from '../ai/body';
import { bodyLine, correspondences, type Adjust } from './bodyTargets';
import { isUpper, type GarmentAnchors, type TryOnKind } from './garmentAnchors';
import { drawWarped, TPS, type P2 } from './tps';

export interface Layer { id: string; image: HTMLCanvasElement | ImageBitmap; anchors: GarmentAnchors; adjust: Adjust }
export interface ComposeInput {
  photo: HTMLCanvasElement;
  mask: HTMLCanvasElement | null;
  analysis: BodyAnalysis;
  layers: Layer[];
  /** 拖曳中用較粗的網格加速 */
  draft?: boolean;
  showAnchors?: boolean;
}
export interface ComposeOutput { canvas: HTMLCanvasElement; notes: string[]; ms: number; anchors: { id: string; dst: P2[]; labels: string[] }[] }

/** 由下往上的圖層順序（Phase 5 會擴充多件組合） */
export const Z: Record<TryOnKind, number> = { pants: 10, shorts: 10, skirt: 12, top: 20, dress: 20, outer: 30 };

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
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

export function composeTryOn(inp: ComposeInput): ComposeOutput {
  const t0 = performance.now();
  const { photo, analysis } = inp;
  const W = photo.width, H = photo.height;
  const out = canvas(W, H), o = ctx(out);
  o.drawImage(photo, 0, 0);
  const notes: string[] = [];
  const anchors: ComposeOutput['anchors'] = [];
  const shW = analysis.measures.shoulderWidth;
  const raw = personMask(inp, 0);
  const dilated = personMask(inp, Math.max(2, shW * 0.03));

  const layers = [...inp.layers].sort((a, b) => Z[a.anchors.kind] - Z[b.anchors.kind]);
  for (const L of layers) {
    const g = L.anchors;
    const corr = correspondences(g, analysis, L.adjust);
    notes.push(...corr.notes);
    let tps: TPS;
    try { tps = new TPS(corr.src, corr.dst); } catch (e) { notes.push(`無法變形：${(e as Error).message}`); continue; }
    const layer = canvas(W, H), lx = ctx(layer);
    lx.imageSmoothingQuality = 'high';
    drawWarped(lx, L.image, tps, inp.draft ? { cols: 8, rows: 12 } : { cols: 18, rows: 26 });

    // 裁切：衣服只出現在身體範圍；洋裝與裙子的下襬（臀線以下）可以超出腿部
    const clip = canvas(W, H), cx = ctx(clip);
    cx.drawImage(dilated, 0, 0);
    if (g.kind === 'dress' || g.kind === 'skirt') {
      const { p, across } = bodyLine(analysis, 0.92);
      const far = (W + H) * 2;
      cx.fillStyle = '#fff';
      cx.beginPath();
      cx.moveTo(p[0] - across[0] * far, p[1] - across[1] * far);
      cx.lineTo(p[0] + across[0] * far, p[1] + across[1] * far);
      cx.lineTo(p[0] + across[0] * far - across[1] * far, p[1] + across[1] * far + across[0] * far);
      cx.lineTo(p[0] - across[0] * far - across[1] * far, p[1] - across[1] * far + across[0] * far);
      cx.closePath(); cx.fill();
    }
    // 上衣不畫到肩線上方太高（領子背面會蓋住脖子與下巴）
    if (isUpper(g.kind)) {
      const { p, across } = bodyLine(analysis, -0.06);
      const far = (W + H) * 2;
      cx.globalCompositeOperation = 'destination-out';
      cx.beginPath();
      cx.moveTo(p[0] - across[0] * far, p[1] - across[1] * far);
      cx.lineTo(p[0] + across[0] * far, p[1] + across[1] * far);
      cx.lineTo(p[0] + across[0] * far + across[1] * far, p[1] + across[1] * far - across[0] * far);
      cx.lineTo(p[0] - across[0] * far + across[1] * far, p[1] - across[1] * far - across[0] * far);
      cx.closePath(); cx.fill();
      cx.globalCompositeOperation = 'source-over';
    }
    lx.globalCompositeOperation = 'destination-in';
    lx.drawImage(clip, 0, 0);

    // 前景遮擋：在衣服前方的手臂與手
    const occ = armOccluder(inp, g.kind, 'sleeve' in g ? g.sleeve : 'none', raw);
    if (occ) { lx.globalCompositeOperation = 'destination-out'; lx.drawImage(occ, 0, 0); }
    lx.globalCompositeOperation = 'source-over';
    o.drawImage(layer, 0, 0);
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
  return { canvas: out, notes: [...new Set(notes)], ms: performance.now() - t0, anchors };
}
