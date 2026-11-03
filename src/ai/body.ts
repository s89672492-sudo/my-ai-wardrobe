/**
 * 人體幾何分析（純函式，不依賴 DOM，可單元測試）。
 * 輸入：MoveNet 17 關鍵點 + 人體遮罩；輸出：試穿需要的身體錨點、寬度量測、
 * 手臂遮擋狀態、朝向與傾斜、品質檢查。
 * 寬度量測與錨點比例參考 pravoobi/try-on tryon-core（MIT）的 anchorMapping/config。
 */
import type { Keypoint } from './protocol';

export type Pt = { x: number; y: number };
export type ArmState = 'side' | 'front' | 'raised' | 'unknown';
export type Facing = 'front' | 'back' | 'side' | 'unknown';
export interface Check { id: string; level: 'ok' | 'info' | 'warn' | 'error'; text: string }

/** 遮罩：person 信心 0~255，覆蓋原圖中的 rect 區域 */
export interface MaskData { data: Uint8ClampedArray; width: number; height: number; rect: { x: number; y: number; w: number; h: number } }

export interface BodyAnalysis {
  version: 1;
  imageW: number;
  imageH: number;
  keypoints: Keypoint[];
  maskRect: { x: number; y: number; w: number; h: number };
  /** 試穿用錨點（左右以「人物本身」的左右，非畫面左右） */
  anchors: {
    shoulderL: Pt; shoulderR: Pt; elbowL: Pt; elbowR: Pt; wristL: Pt; wristR: Pt;
    waistL: Pt; waistR: Pt; hipL: Pt; hipR: Pt; kneeL: Pt; kneeR: Pt; ankleL: Pt; ankleR: Pt;
    neck: Pt; pelvis: Pt;
  };
  /** 皆為原圖像素 */
  measures: {
    shoulderWidth: number; waistWidth: number; hipWidth: number;
    torsoLength: number; legLength: number; armLengthL: number; armLengthR: number;
    /** 寬度是否由輪廓實際量測（否則由關鍵點推估） */
    widthsFromMask: boolean;
    /** 身體中軸與垂直線夾角（度，正值=上身往畫面右傾） */
    tiltDeg: number; shoulderTiltDeg: number; hipTiltDeg: number;
  };
  arms: { left: ArmState; right: ArmState };
  facing: Facing;
  checks: Check[];
}

export const MIN_SCORE = 0.3;
/** 腰線位於肩到臀的比例位置 */
export const WAIST_T = 0.62;
/** 無輪廓時，由關節寬推估外側寬度的倍率（關節在身體內側） */
const WIDTH_SCALE = { shoulder: 1.15, waist: 1.25, hip: 1.45 };
/** 手臂膠囊半徑（肩寬比例） */
export const ARM_RADIUS_FACTOR = 0.14;

const KP = { nose: 0, lSh: 5, rSh: 6, lEl: 7, rEl: 8, lWr: 9, rWr: 10, lHip: 11, rHip: 12, lKn: 13, rKn: 14, lAn: 15, rAn: 16 } as const;
export const PART_ZH: Record<string, string> = {
  nose: '頭部', left_shoulder: '左肩', right_shoulder: '右肩', left_elbow: '左手肘', right_elbow: '右手肘',
  left_wrist: '左手腕', right_wrist: '右手腕', left_hip: '左臀', right_hip: '右臀', left_knee: '左膝', right_knee: '右膝',
  left_ankle: '左腳踝', right_ankle: '右腳踝',
};
/** 可手動校正的關鍵點 */
export const EDITABLE = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const deg = (r: number) => (r * 180) / Math.PI;

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 遮罩在原圖座標 (x,y) 的值 0~255，範圍外為 0 */
export function maskAt(m: MaskData, x: number, y: number): number {
  const mx = Math.floor(((x - m.rect.x) / m.rect.w) * m.width);
  const my = Math.floor(((y - m.rect.y) / m.rect.h) * m.height);
  if (mx < 0 || my < 0 || mx >= m.width || my >= m.height) return 0;
  return m.data[(my * m.width + mx) * 4 + 3]!;
}

/**
 * 在高度 y 從身體中線往左右掃描，量測身體寬度。
 * 碰到背景（遮罩 < 50%）或碰到手臂膠囊就停止，避免把垂在身側的手臂算進腰寬。
 */
export function measureWidthAt(m: MaskData, y: number, cx: number, maxHalf: number, arms: [Pt, Pt][], armR: number): { left: number; right: number } | null {
  if (maskAt(m, cx, y) < 128) return null;
  const step = Math.max(1, m.rect.w / m.width / 2);
  const blocked = (x: number) => maskAt(m, x, y) < 128 || arms.some(([a, b]) => distToSegment({ x, y }, a, b) < armR);
  let l = cx, r = cx;
  while (cx - l < maxHalf && !blocked(l - step)) l -= step;
  while (r - cx < maxHalf && !blocked(r + step)) r += step;
  return { left: l, right: r };
}

export function analyzeBody(keypoints: Keypoint[], imageW: number, imageH: number, mask: MaskData | null): BodyAnalysis {
  const k = (i: number) => keypoints[i]!;
  const P = (i: number): Pt => ({ x: k(i).x, y: k(i).y });
  const ok = (...idx: number[]) => idx.every((i) => k(i).score >= MIN_SCORE);
  const checks: Check[] = [];

  // 朝向：正面時人物的左肩在畫面右側
  const shDx = k(KP.lSh).x - k(KP.rSh).x;
  const shoulderSpan = Math.abs(shDx);
  const torsoLen0 = dist(mid(P(KP.lSh), P(KP.rSh)), mid(P(KP.lHip), P(KP.rHip)));
  let facing: Facing = 'unknown';
  if (ok(KP.lSh, KP.rSh, KP.lHip, KP.rHip)) {
    if (shoulderSpan < torsoLen0 * 0.28) facing = 'side';
    else facing = shDx > 0 ? 'front' : 'back';
  }

  const anchorsBase = {
    shoulderL: P(KP.lSh), shoulderR: P(KP.rSh), elbowL: P(KP.lEl), elbowR: P(KP.rEl), wristL: P(KP.lWr), wristR: P(KP.rWr),
    hipL: P(KP.lHip), hipR: P(KP.rHip), kneeL: P(KP.lKn), kneeR: P(KP.rKn), ankleL: P(KP.lAn), ankleR: P(KP.rAn),
  };
  const neck = mid(anchorsBase.shoulderL, anchorsBase.shoulderR);
  const pelvis = mid(anchorsBase.hipL, anchorsBase.hipR);
  const torsoLength = dist(neck, pelvis);
  const jointShoulder = dist(anchorsBase.shoulderL, anchorsBase.shoulderR);
  const jointHip = dist(anchorsBase.hipL, anchorsBase.hipR);

  // 傾斜
  const tiltDeg = deg(Math.atan2(neck.x - pelvis.x, pelvis.y - neck.y));
  const lineTilt = (a: Pt, b: Pt) => { const d = deg(Math.atan2(a.y - b.y, a.x - b.x)); return Math.abs(d) > 90 ? d - Math.sign(d) * 180 : d; };
  const shoulderTiltDeg = lineTilt(anchorsBase.shoulderL, anchorsBase.shoulderR);
  const hipTiltDeg = lineTilt(anchorsBase.hipL, anchorsBase.hipR);

  // 手臂膠囊（只納入可信的手臂段）
  const armR = Math.max(4, jointShoulder * ARM_RADIUS_FACTOR);
  const segs: [Pt, Pt][] = [];
  for (const [s, e, w] of [[KP.lSh, KP.lEl, KP.lWr], [KP.rSh, KP.rEl, KP.rWr]] as const) {
    if (ok(s, e)) segs.push([lerp(P(s), P(e), 0.35), P(e)]); // 從上臂中段開始，避免擋到肩膀量測
    if (ok(e, w)) segs.push([P(e), P(w)]);
  }

  // 腰線
  const waistC = lerp(neck, pelvis, WAIST_T);
  const waistL0 = lerp(anchorsBase.shoulderL, anchorsBase.hipL, WAIST_T);
  const waistR0 = lerp(anchorsBase.shoulderR, anchorsBase.hipR, WAIST_T);

  // 寬度：先用輪廓量測，失敗則用關節寬推估
  const unit = { x: (anchorsBase.shoulderL.x - anchorsBase.shoulderR.x) / (jointShoulder || 1), y: (anchorsBase.shoulderL.y - anchorsBase.shoulderR.y) / (jointShoulder || 1) };
  const fromJoint = (c: Pt, half: number) => ({ L: { x: c.x + unit.x * half, y: c.y + unit.y * half }, R: { x: c.x - unit.x * half, y: c.y - unit.y * half } });
  let widthsFromMask = false;
  let shoulderW = jointShoulder * WIDTH_SCALE.shoulder;
  let waistW = ((dist(waistL0, waistR0) || jointShoulder) * WIDTH_SCALE.waist);
  let hipW = jointHip * WIDTH_SCALE.hip;
  let waistPts = fromJoint(waistC, waistW / 2);
  let hipPts = fromJoint(pelvis, hipW / 2);
  if (mask && facing !== 'side' && ok(KP.lSh, KP.rSh, KP.lHip, KP.rHip)) {
    const maxHalf = jointShoulder * 1.2;
    const sy = neck.y + torsoLength * 0.12; // 肩線稍下方（避開脖子與肩斜）
    const sw = measureWidthAt(mask, sy, lerp(neck, pelvis, 0.12).x, maxHalf, [], armR);
    const ww = measureWidthAt(mask, waistC.y, waistC.x, maxHalf, segs, armR);
    const hw = measureWidthAt(mask, pelvis.y, pelvis.x, maxHalf * 1.2, segs, armR);
    const sane = (w: number, ref: number) => w > ref * 0.6 && w < ref * 2.2;
    if (sw && ww && hw && sane(sw.right - sw.left, jointShoulder) && sane(ww.right - ww.left, jointShoulder * 0.8) && sane(hw.right - hw.left, jointHip)) {
      widthsFromMask = true;
      shoulderW = Math.max(sw.right - sw.left, jointShoulder);
      waistW = ww.right - ww.left;
      hipW = Math.max(hw.right - hw.left, jointHip);
      // 正面時人物左側在畫面右邊
      const flip = facing === 'back';
      waistPts = { L: { x: flip ? ww.left : ww.right, y: waistC.y }, R: { x: flip ? ww.right : ww.left, y: waistC.y } };
      hipPts = { L: { x: flip ? hw.left : hw.right, y: pelvis.y }, R: { x: flip ? hw.right : hw.left, y: pelvis.y } };
    }
  }

  // 手臂狀態
  const torsoPoly = [lerp(anchorsBase.shoulderL, anchorsBase.shoulderR, 0.12), lerp(anchorsBase.shoulderR, anchorsBase.shoulderL, 0.12), lerp(anchorsBase.hipR, anchorsBase.hipL, 0.08), lerp(anchorsBase.hipL, anchorsBase.hipR, 0.08)];
  const armState = (s: number, e: number, w: number): ArmState => {
    if (!ok(s, e)) return 'unknown';
    if (ok(w) && k(w).y < k(s).y) return 'raised';
    const pts = ok(w) ? [P(e), P(w), lerp(P(e), P(w), 0.5)] : [P(e)];
    return ok(KP.lHip, KP.rHip) && pts.some((p) => pointInPolygon(p, torsoPoly)) ? 'front' : 'side';
  };
  const arms = { left: armState(KP.lSh, KP.lEl, KP.lWr), right: armState(KP.rSh, KP.rEl, KP.rWr) };

  const legLength = ok(KP.lHip, KP.lAn) || ok(KP.rHip, KP.rAn)
    ? Math.max(ok(KP.lHip, KP.lAn) ? dist(P(KP.lHip), P(KP.lKn)) + dist(P(KP.lKn), P(KP.lAn)) : 0, ok(KP.rHip, KP.rAn) ? dist(P(KP.rHip), P(KP.rKn)) + dist(P(KP.rKn), P(KP.rAn)) : 0)
    : 0;
  const armLen = (s: number, e: number, w: number) => (ok(s, e, w) ? dist(P(s), P(e)) + dist(P(e), P(w)) : 0);

  // ---- 品質檢查 ----
  const lowParts = [KP.lSh, KP.rSh, KP.lHip, KP.rHip].filter((i) => k(i).score < MIN_SCORE).map((i) => PART_ZH[k(i).name]);
  if (lowParts.length) checks.push({ id: 'core', level: 'error', text: `找不到${lowParts.join('、')}，無法試穿。請換一張正面、全身清楚的照片，或手動校正關鍵點。` });
  else checks.push({ id: 'core', level: 'ok', text: '已偵測到肩膀與臀部' });

  if (ok(KP.lAn, KP.rAn) && k(KP.nose).score >= MIN_SCORE) checks.push({ id: 'full', level: 'ok', text: '全身入鏡' });
  else if (!ok(KP.lAn, KP.rAn)) checks.push({ id: 'full', level: 'warn', text: '腳踝不在畫面中或不清楚，長褲、裙子與洋裝的長度會用推估值' });
  else checks.push({ id: 'full', level: 'info', text: '沒有偵測到頭部，不影響衣服試穿' });

  if (facing === 'front') checks.push({ id: 'facing', level: 'ok', text: '正面朝向鏡頭' });
  else if (facing === 'back') checks.push({ id: 'facing', level: 'warn', text: '看起來是背面或左右相反（例如鏡像自拍）。若是正面照，請用「校正關鍵點」把左右肩對調' });
  else if (facing === 'side') checks.push({ id: 'facing', level: 'warn', text: '身體側身角度較大，試穿效果會較差，建議正面拍攝' });

  if (Math.abs(tiltDeg) > 8) checks.push({ id: 'tilt', level: 'warn', text: `身體傾斜約 ${Math.abs(tiltDeg).toFixed(0)}°，可使用「自動轉正」` });
  else if (Math.abs(tiltDeg) > 3) checks.push({ id: 'tilt', level: 'info', text: `身體略為傾斜 ${Math.abs(tiltDeg).toFixed(0)}°` });

  const heightPx = Math.max(...keypoints.filter((p) => p.score >= MIN_SCORE).map((p) => p.y)) - Math.min(...keypoints.filter((p) => p.score >= MIN_SCORE).map((p) => p.y));
  if (heightPx > 0 && heightPx < 400) checks.push({ id: 'res', level: 'warn', text: '人物在照片中太小，試穿細節會模糊，建議靠近一點拍或裁切' });

  const front = (['left', 'right'] as const).filter((s) => arms[s] === 'front');
  if (front.length) checks.push({ id: 'arms', level: 'info', text: `${front.map((s) => (s === 'left' ? '左手' : '右手')).join('、')}在身體前方，試穿時手臂會保留在衣服前面` });
  if (arms.left === 'raised' || arms.right === 'raised') checks.push({ id: 'raised', level: 'info', text: '手臂舉高時，袖子變形效果會較差' });

  if (!mask) checks.push({ id: 'mask', level: 'warn', text: '沒有人體輪廓，衣服可能超出身體範圍' });
  else if (!widthsFromMask && !lowParts.length && facing !== 'side') checks.push({ id: 'mask', level: 'info', text: '輪廓量測不穩定，身體寬度改用關鍵點推估' });

  return {
    version: 1, imageW, imageH, keypoints,
    maskRect: mask?.rect ?? { x: 0, y: 0, w: imageW, h: imageH },
    anchors: { ...anchorsBase, waistL: waistPts.L, waistR: waistPts.R, hipL: hipPts.L, hipR: hipPts.R, neck, pelvis },
    measures: {
      shoulderWidth: shoulderW, waistWidth: waistW, hipWidth: hipW, torsoLength, legLength,
      armLengthL: armLen(KP.lSh, KP.lEl, KP.lWr), armLengthR: armLen(KP.rSh, KP.rEl, KP.rWr),
      widthsFromMask, tiltDeg, shoulderTiltDeg, hipTiltDeg,
    },
    arms, facing, checks,
  };
}

/** 手臂膠囊（上臂 + 前臂），供繪製手臂遮擋遮罩用 */
export function armCapsules(a: BodyAnalysis): { a: Pt; b: Pt; r: number; side: 'left' | 'right' }[] {
  const r = Math.max(4, dist(a.keypoints[5]!, a.keypoints[6]!) * ARM_RADIUS_FACTOR);
  const out: { a: Pt; b: Pt; r: number; side: 'left' | 'right' }[] = [];
  const ok = (i: number) => a.keypoints[i]!.score >= MIN_SCORE;
  for (const [s, e, w, side] of [[5, 7, 9, 'left'], [6, 8, 10, 'right']] as const) {
    if (ok(s) && ok(e)) out.push({ a: lerp(a.keypoints[s]!, a.keypoints[e]!, 0.25), b: a.keypoints[e]!, r, side });
    if (ok(e) && ok(w)) out.push({ a: a.keypoints[e]!, b: a.keypoints[w]!, r: r * 0.85, side });
  }
  return out;
}
