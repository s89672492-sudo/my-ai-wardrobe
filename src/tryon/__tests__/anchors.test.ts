import { describe, expect, it } from 'vitest';
import { analyzeBody } from '../../ai/body';
import { KEYPOINT_NAMES, type Keypoint } from '../../ai/protocol';
import { correspondences, NO_ADJUST } from '../bodyTargets';
import { detectAnchors, type LowerAnchors, type UpperAnchors } from '../garmentAnchors';

/** 在 w×h 畫布上以多邊形組合畫出 alpha（不依賴 DOM） */
function shape(w: number, h: number, fill: (x: number, y: number) => boolean) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fill(x, y)) a[(y * w + x) * 4 + 3] = 255;
  return a;
}
const inRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x < x1 && y >= y0 && y < y1;

// T-shirt：衣身 100..300 × 40..380，短袖往外斜伸到 20..380（40..140），領口 170..230 在最上方挖空
const TEE = shape(400, 400, (x, y) => (inRect(x, y, 100, 40, 300, 380) && !(y < 60 && x > 170 && x < 230)) || (inRect(x, y, 20, 40, 380, 130) && y > 40 + Math.abs(x - 200) * 0.1));
const TANK = shape(400, 400, (x, y) => inRect(x, y, 120, 30, 280, 380) && !(y < 70 && x > 160 && x < 240));
// 長袖：衣身 120..280，袖子貼在兩側往下到 300
const LONG = shape(400, 400, (x, y) => inRect(x, y, 120, 30, 280, 380) || inRect(x, y, 60, 30, 120, 300) || inRect(x, y, 280, 30, 340, 300));
// 長褲（真實牛仔褲平放約為 長 ≈ 2.6 × 腰寬）：腰頭 100..300 × 20..120，褲管到 540
const PANTS = shape(400, 560, (x, y) => inRect(x, y, 100, 20, 300, 120) || inRect(x, y, 100, 120, 195, 540) || inRect(x, y, 205, 120, 300, 540));
const VERY_LONG = shape(400, 900, (x, y) => inRect(x, y, 100, 20, 300, 120) || inRect(x, y, 100, 120, 195, 880) || inRect(x, y, 205, 120, 300, 880));
// 裙子：梯形
const SKIRT = shape(400, 300, (x, y) => y >= 20 && y < 280 && Math.abs(x - 200) < 70 + (y - 20) * 0.4);

describe('detectAnchors', () => {
  it('T-shirt：肩線在衣身邊緣而非袖尖，判定短袖', () => {
    const g = detectAnchors(TEE, 400, 400, 'top') as UpperAnchors;
    expect(g.shoulderL[0]).toBeGreaterThanOrEqual(95); expect(g.shoulderR[0]).toBeLessThanOrEqual(305);
    expect(g.sleeve).toBe('short');
    expect(g.cuffL![0]).toBeLessThan(40); expect(g.cuffR![0]).toBeGreaterThan(360);
    expect(g.hemL[1]).toBe(379);
  });
  it('背心：無袖', () => {
    expect((detectAnchors(TANK, 400, 400, 'top') as UpperAnchors).sleeve).toBe('none');
  });
  it('長袖：判定長袖，下襬只取衣身', () => {
    const g = detectAnchors(LONG, 400, 400, 'top') as UpperAnchors;
    expect(g.sleeve).toBe('long');
    expect(g.hemL[0]).toBeCloseTo(120, 0); expect(g.hemR[0]).toBeCloseTo(279, 0);
  });
  it('長褲：腰頭、褲口外側、褲襠', () => {
    const g = detectAnchors(PANTS, 400, 560, 'pants') as LowerAnchors;
    expect(g.bandL[0]).toBe(100); expect(g.bandR[0]).toBe(299);
    expect(g.crotch![1]).toBeGreaterThanOrEqual(120); expect(g.crotch![1]).toBeLessThan(130);
    expect(g.hemL[0]).toBe(100); expect(g.hemR[0]).toBe(299);
  });
  it('裙子：沒有褲襠，下襬比腰頭寬', () => {
    const g = detectAnchors(SKIRT, 400, 300, 'skirt') as LowerAnchors;
    expect(g.crotch).toBeNull();
    expect(g.hemR[0] - g.hemL[0]).toBeGreaterThan(g.bandR[0] - g.bandL[0]);
  });
});

function frontal(over: Partial<Record<string, [number, number]>> = {}): Keypoint[] {
  const base: Record<string, [number, number]> = {
    nose: [300, 150], left_eye: [310, 140], right_eye: [290, 140], left_ear: [320, 145], right_ear: [280, 145],
    left_shoulder: [370, 260], right_shoulder: [230, 260], left_elbow: [400, 420], right_elbow: [200, 420],
    left_wrist: [410, 560], right_wrist: [190, 560], left_hip: [345, 560], right_hip: [255, 560],
    left_knee: [340, 800], right_knee: [260, 800], left_ankle: [340, 1040], right_ankle: [260, 1040],
  };
  return KEYPOINT_NAMES.map((name) => { const [x, y] = over[name] ?? base[name]!; return { name, x, y, score: 0.9 }; });
}
const body = analyzeBody(frontal(), 600, 1200, null);

describe('correspondences', () => {
  it('上衣：畫面左肩對到人物右肩（畫面左側），寬度等於量測肩寬', () => {
    const g = detectAnchors(TANK, 400, 400, 'top')!;
    const c = correspondences(g, body);
    const [l, r] = [c.dst[0]!, c.dst[1]!];
    expect(l[0]).toBeLessThan(r[0]);
    expect(r[0] - l[0]).toBeCloseTo(body.measures.shoulderWidth, 0);
  });
  it('衣長沿用衣服比例：較長的衣服下襬較低', () => {
    const short = shape(400, 400, (x, y) => inRect(x, y, 120, 30, 280, 200));
    const c1 = correspondences(detectAnchors(short, 400, 400, 'top')!, body);
    const c2 = correspondences(detectAnchors(TANK, 400, 400, 'top')!, body);
    expect(c2.dst[4]![1]).toBeGreaterThan(c1.dst[4]![1] + 100);
  });
  it('長褲：褲口在膝蓋以下（長度沿用衣服比例）', () => {
    const c = correspondences(detectAnchors(PANTS, 400, 560, 'pants')!, body);
    const hemY = (c.dst[2]![1] + c.dst[3]![1]) / 2;
    expect(hemY).toBeGreaterThan(850); expect(hemY).toBeLessThan(1080);
  });
  it('過長的褲子：最多到腳踝下緣', () => {
    const c = correspondences(detectAnchors(VERY_LONG, 400, 900, 'pants')!, body);
    expect(Math.max(c.dst[2]![1], c.dst[3]![1])).toBeLessThanOrEqual(1040 + 300 * 0.04 + 1);
  });
  it('長褲：畫面左褲管在左腿外側', () => {
    const c = correspondences(detectAnchors(PANTS, 400, 560, 'pants')!, body);
    expect(c.dst[2]![0]).toBeLessThan(255); expect(c.dst[3]![0]).toBeGreaterThan(345);
  });
  it('手動調整：位移與放大', () => {
    const g = detectAnchors(TANK, 400, 400, 'top')!;
    const a = correspondences(g, body), b = correspondences(g, body, { ...NO_ADJUST, dx: 10, scale: 1.2 });
    expect(b.dst[1]![0] - b.dst[0]![0]).toBeCloseTo((a.dst[1]![0] - a.dst[0]![0]) * 1.2, 3);
    expect((b.dst[0]![0] + b.dst[1]![0]) / 2).toBeCloseTo((a.dst[0]![0] + a.dst[1]![0]) / 2 + 10, 3);
  });
  it('手肘大幅彎曲時不強制對齊長袖', () => {
    const bent = analyzeBody(frontal({ left_elbow: [440, 400], left_wrist: [360, 330] }), 600, 1200, null);
    const c = correspondences(detectAnchors(LONG, 400, 400, 'top')!, bent);
    expect(c.notes.some((n) => /手肘彎曲/.test(n))).toBe(true);
  });
});
