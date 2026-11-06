import { describe, expect, it } from 'vitest';
import { refineAlpha } from '../matting';

/** 白底上一條紅色細肩帶（寬 3px），AI 遮罩模糊又偏胖 */
function strapScene(w = 60, h = 40) {
  const rgba = new Uint8ClampedArray(w * h * 4), truth = new Uint8ClampedArray(w * h), blurry = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, inStrap = x >= 28 && x < 31, inBody = y >= 25;
    const fg = inStrap || inBody;
    rgba[i * 4] = fg ? 200 : 245; rgba[i * 4 + 1] = fg ? 30 : 245; rgba[i * 4 + 2] = fg ? 40 : 245; rgba[i * 4 + 3] = 255;
    truth[i] = fg ? 255 : 0;
    // 模糊遮罩：肩帶被畫成寬 11px 的半透明帶，衣身邊緣也糊掉
    const dx = Math.abs(x - 29.5);
    const strapA = dx < 5.5 ? 160 : 0;
    const bodyA = y >= 27 ? 255 : y >= 23 ? 140 : 0;
    blurry[i] = Math.max(strapA, bodyA);
  }
  return { rgba, truth, blurry, w, h };
}
const err = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!); return s / a.length; };

describe('refineAlpha', () => {
  it('pulls a blurry mask toward the real garment edge when colors differ', () => {
    const s = strapScene();
    const refined = refineAlpha(s.rgba, s.blurry, s.w, s.h, 6);
    expect(err(refined, s.truth)).toBeLessThan(err(s.blurry, s.truth) * 0.6);
  });
  it('leaves the mask alone when garment and background colors are the same', () => {
    const s = strapScene();
    for (let i = 0; i < s.w * s.h; i++) { s.rgba[i * 4] = 240; s.rgba[i * 4 + 1] = 240; s.rgba[i * 4 + 2] = 240; }
    const refined = refineAlpha(s.rgba, s.blurry, s.w, s.h, 6);
    expect(Array.from(refined)).toEqual(Array.from(s.blurry));
  });
  it('keeps confident interior pixels opaque', () => {
    const s = strapScene();
    const refined = refineAlpha(s.rgba, s.blurry, s.w, s.h, 6);
    expect(refined[35 * s.w + 10]).toBe(255);
    expect(refined[5 * s.w + 5]).toBe(0);
  });
});
