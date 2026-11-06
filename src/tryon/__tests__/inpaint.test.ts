import { describe, expect, it } from 'vitest';
import { pullPush } from '../compose';

describe('pull-push fill', () => {
  it('fills a hole in a flat color with that color', () => {
    const w = 32, h = 32, rgb = new Float32Array(w * h * 3), wt = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { rgb[i * 3] = 200; rgb[i * 3 + 1] = 100; rgb[i * 3 + 2] = 50; wt[i] = 1; }
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) { const i = y * w + x; wt[i] = 0; rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = 0; }
    const out = pullPush(rgb, wt, w, h);
    const i = 15 * w + 15;
    expect(out[i * 3]).toBeCloseTo(200, 0);
    expect(out[i * 3 + 1]).toBeCloseTo(100, 0);
    expect(out[i * 3 + 2]).toBeCloseTo(50, 0);
  });
  it('blends between different colors on both sides of a hole and keeps known pixels', () => {
    const w = 40, h = 8, rgb = new Float32Array(w * h * 3), wt = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, v = x < 20 ? 0 : 255;
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v; wt[i] = x >= 14 && x < 26 ? 0 : 1;
    }
    const out = pullPush(rgb, wt, w, h);
    const at = (x: number) => out[(4 * w + x) * 3]!;
    expect(at(2)).toBe(0);
    expect(at(38)).toBe(255);
    expect(at(15)).toBeLessThan(at(24)); // 靠左較暗、靠右較亮
    expect(at(15)).toBeGreaterThanOrEqual(0);
    expect(at(24)).toBeLessThanOrEqual(255);
  });
});
