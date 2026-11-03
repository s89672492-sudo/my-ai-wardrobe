import { describe, expect, it } from 'vitest';
import { analyzeBody, measureWidthAt, pointInPolygon, type MaskData } from '../body';
import { KEYPOINT_NAMES, type Keypoint } from '../protocol';

/** 正面站姿（畫面 600×1200）：人物左肩在畫面右邊 */
function frontal(over: Partial<Record<string, [number, number]>> = {}, score = 0.8): Keypoint[] {
  const base: Record<string, [number, number]> = {
    nose: [300, 150], left_eye: [310, 140], right_eye: [290, 140], left_ear: [320, 145], right_ear: [280, 145],
    left_shoulder: [370, 260], right_shoulder: [230, 260], left_elbow: [400, 420], right_elbow: [200, 420],
    left_wrist: [410, 560], right_wrist: [190, 560], left_hip: [345, 560], right_hip: [255, 560],
    left_knee: [340, 800], right_knee: [260, 800], left_ankle: [340, 1040], right_ankle: [260, 1040],
  };
  return KEYPOINT_NAMES.map((name) => { const [x, y] = over[name] ?? base[name]!; return { name, x, y, score }; });
}

/** 合成遮罩：軀幹矩形 x 220..380（寬 160），手臂為兩條細柱 x 185..215 / 385..415 緊貼身體 */
function mask(): MaskData {
  const W = 600, H = 1200, data = new Uint8ClampedArray(W * H * 4);
  const fill = (x0: number, x1: number, y0: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[(y * W + x) * 4 + 3] = 255; };
  fill(220, 381, 240, 600);   // 軀幹
  fill(180, 220, 260, 580);   // 右手（畫面左）緊貼
  fill(381, 421, 260, 580);   // 左手（畫面右）
  fill(240, 361, 600, 1060);  // 腿
  return { data, width: W, height: H, rect: { x: 0, y: 0, w: W, h: H } };
}

describe('analyzeBody', () => {
  it('偵測正面、全身、不傾斜', () => {
    const a = analyzeBody(frontal(), 600, 1200, null);
    expect(a.facing).toBe('front');
    expect(Math.abs(a.measures.tiltDeg)).toBeLessThan(1);
    expect(a.checks.find((c) => c.id === 'full')?.level).toBe('ok');
    expect(a.arms).toEqual({ left: 'side', right: 'side' });
  });

  it('左右肩對調時判定為背面', () => {
    const a = analyzeBody(frontal({ left_shoulder: [230, 260], right_shoulder: [370, 260] }), 600, 1200, null);
    expect(a.facing).toBe('back');
    expect(a.checks.find((c) => c.id === 'facing')?.level).toBe('warn');
  });

  it('手腕在軀幹上判定手臂在前方', () => {
    const a = analyzeBody(frontal({ left_wrist: [300, 420], left_elbow: [380, 450] }), 600, 1200, null);
    expect(a.arms.left).toBe('front');
    expect(a.arms.right).toBe('side');
  });

  it('手腕高於肩膀判定舉手', () => {
    expect(analyzeBody(frontal({ right_wrist: [180, 150], right_elbow: [190, 220] }), 600, 1200, null).arms.right).toBe('raised');
  });

  it('身體傾斜時提示自動轉正', () => {
    const kp = frontal().map((k) => ({ ...k, x: k.x + (1040 - k.y) * 0.25 }));
    const a = analyzeBody(kp, 600, 1200, null);
    expect(Math.abs(a.measures.tiltDeg)).toBeGreaterThan(8);
    expect(a.checks.find((c) => c.id === 'tilt')?.level).toBe('warn');
  });

  it('核心關鍵點缺失時回報錯誤', () => {
    const kp = frontal();
    kp[11] = { ...kp[11]!, score: 0.1 };
    expect(analyzeBody(kp, 600, 1200, null).checks.find((c) => c.id === 'core')?.level).toBe('error');
  });

  it('由輪廓量測腰寬時排除貼身的手臂', () => {
    const a = analyzeBody(frontal(), 600, 1200, mask());
    expect(a.measures.widthsFromMask).toBe(true);
    // 軀幹實際寬 160；若把手臂算進去會是 240
    expect(a.measures.waistWidth).toBeGreaterThan(140);
    expect(a.measures.waistWidth).toBeLessThan(185);
    // 人物左腰在畫面右側
    expect(a.anchors.waistL.x).toBeGreaterThan(a.anchors.waistR.x);
  });
});

describe('geometry helpers', () => {
  it('pointInPolygon', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
  });
  it('measureWidthAt 在背景回傳 null', () => {
    expect(measureWidthAt(mask(), 100, 50, 200, [], 10)).toBeNull();
  });
});
