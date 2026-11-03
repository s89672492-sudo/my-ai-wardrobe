/**
 * Thin-Plate Spline 變形與 Canvas 三角網格繪製。
 * TPS 解算改寫自 pravoobi/try-on packages/thin-plate-spline（MIT）。
 * 改良：繪製每個三角形時把裁切路徑向外擴約 0.75px，消除三角形之間的細縫。
 */
export type P2 = readonly [number, number];

const U = (r2: number) => (r2 <= 0 ? 0 : r2 * Math.log(r2));

function solve(a: number[][], b: number[]): number[] {
  const n = b.length, m = a.map((r) => r.slice()), rhs = b.slice();
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-12) throw new Error('TPS 控制點重疊或共線，無法計算變形');
    [m[c], m[p]] = [m[p]!, m[c]!]; [rhs[c], rhs[p]] = [rhs[p]!, rhs[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = m[r]![c]! / m[c]![c]!;
      if (!f) continue;
      for (let k = c; k < n; k++) m[r]![k]! -= f * m[c]![k]!;
      rhs[r]! -= f * rhs[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = rhs[r]!; for (let k = r + 1; k < n; k++) s -= m[r]![k]! * x[k]!; x[r] = s / m[r]![r]!; }
  return x;
}

export class TPS {
  private wx: number[]; private wy: number[]; private ax: number[]; private ay: number[];
  constructor(private src: readonly P2[], dst: readonly P2[], regularization = 0) {
    if (src.length !== dst.length || src.length < 3) throw new Error('TPS 需要至少 3 組對應點');
    const n = src.length, M = Array.from({ length: n + 3 }, () => new Array<number>(n + 3).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) { const dx = src[i]![0] - src[j]![0], dy = src[i]![1] - src[j]![1]; M[i]![j] = U(dx * dx + dy * dy); }
      M[i]![i]! += regularization;
      M[i]![n] = 1; M[i]![n + 1] = src[i]![0]; M[i]![n + 2] = src[i]![1];
      M[n]![i] = 1; M[n + 1]![i] = src[i]![0]; M[n + 2]![i] = src[i]![1];
    }
    const sx = solve(M, [...dst.map((p) => p[0]), 0, 0, 0]), sy = solve(M, [...dst.map((p) => p[1]), 0, 0, 0]);
    this.wx = sx.slice(0, n); this.ax = sx.slice(n); this.wy = sy.slice(0, n); this.ay = sy.slice(n);
  }
  eval(p: P2): [number, number] {
    let x = this.ax[0]! + this.ax[1]! * p[0] + this.ax[2]! * p[1];
    let y = this.ay[0]! + this.ay[1]! * p[0] + this.ay[2]! * p[1];
    for (let i = 0; i < this.src.length; i++) {
      const dx = p[0] - this.src[i]![0], dy = p[1] - this.src[i]![1], u = U(dx * dx + dy * dy);
      x += this.wx[i]! * u; y += this.wy[i]! * u;
    }
    return [x, y];
  }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function tri(ctx: Ctx, img: CanvasImageSource, s: [P2, P2, P2], d: [P2, P2, P2]) {
  const [[sx0, sy0], [sx1, sy1], [sx2, sy2]] = s, [[dx0, dy0], [dx1, dy1], [dx2, dy2]] = d;
  const u1 = sx1 - sx0, v1 = sy1 - sy0, u2 = sx2 - sx0, v2 = sy2 - sy0;
  const delta = u1 * v2 - u2 * v1;
  if (Math.abs(delta) < 1e-9) return;
  const x1 = dx1 - dx0, y1 = dy1 - dy0, x2 = dx2 - dx0, y2 = dy2 - dy0;
  const a = (x1 * v2 - x2 * v1) / delta, b = (y1 * v2 - y2 * v1) / delta;
  const c = (x2 * u1 - x1 * u2) / delta, dd = (y2 * u1 - y1 * u2) / delta;
  // 裁切路徑由重心外擴，消除接縫
  const cx = (dx0 + dx1 + dx2) / 3, cy = (dy0 + dy1 + dy2) / 3;
  const grow = (x: number, y: number): [number, number] => { const l = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / l) * 0.75, y + ((y - cy) / l) * 0.75]; };
  const [g0, g1, g2] = [grow(dx0, dy0), grow(dx1, dy1), grow(dx2, dy2)];
  ctx.save();
  ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]); ctx.closePath(); ctx.clip();
  ctx.transform(a, b, c, dd, dx0 - a * sx0 - c * sy0, dy0 - b * sx0 - dd * sy0);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** 以 TPS 將整張衣服圖（src 座標）變形繪製到 ctx（dst 座標）。 */
export function drawWarped(ctx: Ctx, img: CanvasImageSource & { width: number; height: number }, tps: TPS, grid: { cols: number; rows: number }) {
  const { cols, rows } = grid, W = img.width, H = img.height;
  const S: P2[][] = [], D: P2[][] = [];
  for (let j = 0; j <= rows; j++) {
    const sr: P2[] = [], dr: P2[] = [];
    for (let i = 0; i <= cols; i++) { const p: P2 = [(W * i) / cols, (H * j) / rows]; sr.push(p); dr.push(tps.eval(p)); }
    S.push(sr); D.push(dr);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    tri(ctx, img, [S[j]![i]!, S[j]![i + 1]!, S[j + 1]![i]!], [D[j]![i]!, D[j]![i + 1]!, D[j + 1]![i]!]);
    tri(ctx, img, [S[j]![i + 1]!, S[j + 1]![i + 1]!, S[j + 1]![i]!], [D[j]![i + 1]!, D[j + 1]![i + 1]!, D[j + 1]![i]!]);
  }
}
