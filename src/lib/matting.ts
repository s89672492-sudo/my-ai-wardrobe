/**
 * 去背邊緣修飾（依顏色）：只處理遮罩邊緣一圈。
 * 每個邊緣像素看附近「確定是衣服」與「確定是背景」的平均顏色，
 * 依自己的顏色比較接近哪一邊重新估計透明度（類似簡化版的影像去背 matting）。
 * 衣服和背景顏色太接近時（無法分辨）維持原本的透明度。
 */
export function refineAlpha(rgba: Uint8ClampedArray, alpha: Uint8ClampedArray, w: number, h: number, radius = 6): Uint8ClampedArray {
  const W1 = w + 1;
  // 積分圖：確定前景／背景的 RGB 總和與數量
  const fgS = [new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1))];
  const bgS = [new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1)), new Float64Array(W1 * (h + 1))];
  const fgN = new Float64Array(W1 * (h + 1)), bgN = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    const rs = [[0, 0, 0], [0, 0, 0]], rn = [0, 0];
    for (let x = 0; x < w; x++) {
      const i = y * w + x, a = alpha[i]!;
      const side = a > 235 ? 0 : a < 20 ? 1 : -1;
      if (side >= 0) { rn[side]!++; for (let k = 0; k < 3; k++) rs[side]![k]! += rgba[i * 4 + k]!; }
      const j = (y + 1) * W1 + x + 1, up = y * W1 + x + 1;
      fgN[j] = fgN[up]! + rn[0]!; bgN[j] = bgN[up]! + rn[1]!;
      for (let k = 0; k < 3; k++) { fgS[k]![j] = fgS[k]![up]! + rs[0]![k]!; bgS[k]![j] = bgS[k]![up]! + rs[1]![k]!; }
    }
  }
  const box = (S: Float64Array, x0: number, y0: number, x1: number, y1: number) => S[y1 * W1 + x1]! - S[y0 * W1 + x1]! - S[y1 * W1 + x0]! + S[y0 * W1 + x0]!;
  // 邊緣帶：附近同時有前景與背景（或本身半透明）
  const out = new Uint8ClampedArray(alpha);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius), x1 = Math.min(w, x + radius + 1), y1 = Math.min(h, y + radius + 1);
    const nf = box(fgN, x0, y0, x1, y1), nb = box(bgN, x0, y0, x1, y1);
    if (nf < 3 || nb < 3) continue; // 不在邊緣
    const F = [0, 1, 2].map((k) => box(fgS[k]!, x0, y0, x1, y1) / nf);
    const B = [0, 1, 2].map((k) => box(bgS[k]!, x0, y0, x1, y1) / nb);
    const d = [F[0]! - B[0]!, F[1]! - B[1]!, F[2]! - B[2]!];
    const dd = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
    if (dd < 30 * 30) continue; // 顏色太接近，無法依顏色判斷
    const c = [rgba[i * 4]! - B[0]!, rgba[i * 4 + 1]! - B[1]!, rgba[i * 4 + 2]! - B[2]!];
    const t = Math.max(0, Math.min(1, (c[0]! * d[0]! + c[1]! * d[1]! + c[2]! * d[2]!) / dd));
    // 與原本的 AI 透明度混合：對比越高越相信顏色
    const trust = Math.min(1, Math.sqrt(dd) / 120) * 0.85;
    out[i] = Math.round((alpha[i]! / 255) * (1 - trust) * 255 + t * trust * 255);
  }
  return out;
}
