// 改寫自 pravoobi/try-on packages/tryon-core/src/letterbox.ts（MIT）
export interface Letterbox { srcW: number; srcH: number; targetW: number; targetH: number; scaledW: number; scaledH: number; dx: number; dy: number }

export function computeLetterbox(srcW: number, srcH: number, targetW: number, targetH: number): Letterbox {
  if (srcW <= 0 || srcH <= 0) throw new Error(`圖片尺寸無效 ${srcW}x${srcH}`);
  const scale = Math.min(targetW / srcW, targetH / srcH);
  const scaledW = Math.max(1, Math.round(srcW * scale));
  const scaledH = Math.max(1, Math.round(srcH * scale));
  return { srcW, srcH, targetW, targetH, scaledW, scaledH, dx: Math.floor((targetW - scaledW) / 2), dy: Math.floor((targetH - scaledH) / 2) };
}

export function unletterboxPoint(x: number, y: number, lb: Letterbox) {
  return { x: ((x - lb.dx) * lb.srcW) / lb.scaledW, y: ((y - lb.dy) * lb.srcH) / lb.scaledH };
}
