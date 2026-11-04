import { describe, expect, it } from 'vitest';
import { shapeOf, suggestCategory } from '../category';

/** 以多邊形畫出合成的衣服剪影（RGBA，alpha=255 為衣服） */
function silhouette(w: number, h: number, inside: (x: number, y: number) => boolean) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x / w, y / h)) a[(y * w + x) * 4 + 3] = 255;
  return a;
}
const W = 200;
// 長褲：腰頭在上方 0.05~0.3，0.3 以下分成兩條褲管
const pants = silhouette(W, 400, (x, y) => y > 0.02 && y < 0.98 && x > 0.15 && x < 0.85 && (y < 0.3 || Math.abs(x - 0.5) > 0.06));
// 短褲：長寬比小，褲管從 0.45 分開
const shorts = silhouette(W, 180, (x, y) => y > 0.03 && y < 0.97 && x > 0.08 && x < 0.92 && (y < 0.45 || Math.abs(x - 0.5) > 0.07));
// 裙子：梯形，沒有分開的褲管
const skirt = silhouette(W, 200, (x, y) => y > 0.03 && y < 0.97 && Math.abs(x - 0.5) < 0.2 + y * 0.25);
// T-shirt：上方有袖子（較寬），衣身較窄
const tee = silhouette(W, 220, (x, y) => y > 0.03 && y < 0.97 && (Math.abs(x - 0.5) < 0.25 || (y < 0.35 && Math.abs(x - 0.5) < 0.47)));
// 長洋裝：細長、沒有袖子
const dress = silhouette(W, 400, (x, y) => y > 0.02 && y < 0.98 && Math.abs(x - 0.5) < 0.18 + y * 0.12);

describe('garment shape', () => {
  it('detects two legs for pants and shorts, not for skirts', () => {
    expect(shapeOf(pants, W, 400)!.twoLegs).toBe(true);
    expect(shapeOf(shorts, W, 180)!.twoLegs).toBe(true);
    expect(shapeOf(skirt, W, 200)!.twoLegs).toBe(false);
  });
  it('measures sleeves on a T-shirt', () => {
    expect(shapeOf(tee, W, 220)!.shoulderSpread).toBeGreaterThan(1.25);
  });
});

describe('category suggestion', () => {
  const jean = [{ index: 608, score: 0.4 }];
  const jersey = [{ index: 610, score: 0.3 }];
  it('splits pants and shorts by shape even when the classifier says jeans', () => {
    expect(suggestCategory(jean, shapeOf(pants, W, 400))!.category).toBe('pants');
    expect(suggestCategory(jean, shapeOf(shorts, W, 180))!.category).toBe('shorts');
  });
  it('uses the shape when the classifier has no clothing class', () => {
    const s = suggestCategory([{ index: 885, score: 0.7 }], shapeOf(pants, W, 400));
    expect(s?.category).toBe('pants');
  });
  it('keeps the classifier answer for tops and turns a long sleeveless "T-shirt" into a dress', () => {
    expect(suggestCategory(jersey, shapeOf(tee, W, 220))!.category).toBe('tshirt');
    expect(suggestCategory(jersey, shapeOf(dress, W, 400))!.category).toBe('dress');
  });
  it('gives no suggestion when nothing matches', () => {
    expect(suggestCategory([{ index: 885, score: 0.7 }], shapeOf(skirt, W, 200))).toBeNull();
  });
});
