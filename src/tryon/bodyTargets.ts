/**
 * 依服裝種類，把衣服錨點對應到身體上的目標位置（畫面座標）。
 * 原則：
 * - 比例：以「肩寬」（上衣）或「腰頭寬」（下身）決定縮放，衣長、褲長、袖長沿用衣服本身比例，
 *   所以短版上衣、長版 T、七分褲會自然呈現不同長度。
 * - 寬度：衣服不會比身體窄（窄的衣服會被撐開到身體寬度＋鬆份），寬鬆的衣服保留原本寬度。
 * - 袖子：沿手臂骨架擺放；手肘彎曲過大時不強制拉長袖（避免整件衣服被扭曲）。
 */
import { MIN_SCORE, WAIST_T, type BodyAnalysis, type Pt } from '../ai/body';
import type { GarmentAnchors, LowerAnchors, TryOnKind, UpperAnchors } from './garmentAnchors';
import type { P2 } from './tps';
import { BAND_T } from './outfit';

export interface Adjust { dx: number; dy: number; scale: number; rotate: number; length: number }
export const NO_ADJUST: Adjust = { dx: 0, dy: 0, scale: 1, rotate: 0, length: 1 };

export interface Correspondence { src: P2[]; dst: P2[]; labels: string[]; /** 衣服頂端中心（調整的旋轉／縮放中心） */ origin: P2; /** 身體軸向（往下）單位向量 */ down: P2; notes: string[] }

/** 鬆份：衣服相對身體的最小外擴比例 */
const EASE: Record<TryOnKind, number> = { top: 1.05, outer: 1.1, dress: 1.05, pants: 1.04, shorts: 1.05, skirt: 1.06 };

interface Body {
  ok: (i: number) => boolean;
  kp: (i: number) => Pt;
  /** 畫面左／右的關節（依朝向轉換） */
  shL: Pt; shR: Pt; hipL: Pt; hipR: Pt; elL: Pt; elR: Pt; wrL: Pt; wrR: Pt; knL: Pt; knR: Pt; anL: Pt; anR: Pt;
  okArm: { L: [boolean, boolean, boolean]; R: [boolean, boolean, boolean] };
  okLeg: { L: [boolean, boolean]; R: [boolean, boolean] };
  neck: Pt; pelvis: Pt; down: Pt; across: Pt; torso: number;
  shoulderHalf: number; waistHalf: number; hipHalf: number; waistY: number; armR: number;
  /** 衣服肩線縫位的半寬（肩峰），不含垂在身側的上臂 */
  seamHalf: number;
}

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const len = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const p2 = (p: Pt): P2 => [p.x, p.y];

function bodyOf(a: BodyAnalysis): Body {
  const K = a.keypoints;
  const ok = (i: number) => K[i]!.score >= MIN_SCORE;
  const kp = (i: number): Pt => ({ x: K[i]!.x, y: K[i]!.y });
  // 正面照：人物右側在畫面左側。背面照則相反。
  const front = a.facing !== 'back';
  // MoveNet：人物左側為奇數索引（5 左肩），右側為 +1（6 右肩）
  const [iL, iR] = front ? [1, 0] : [0, 1];
  const pick = (left: number) => [kp(left + iL), kp(left + iR)] as const; // left 為人物左側的索引
  const [shL, shR] = pick(5), [elL, elR] = pick(7), [wrL, wrR] = pick(9), [hipL, hipR] = pick(11), [knL, knR] = pick(13), [anL, anR] = pick(15);
  const o = (left: number) => [ok(left + iL), ok(left + iR)] as const;
  const neck = lerp(shL, shR, 0.5), pelvis = lerp(hipL, hipR, 0.5);
  const torso = Math.max(1, len(neck, pelvis));
  const down = { x: (pelvis.x - neck.x) / torso, y: (pelvis.y - neck.y) / torso };
  const across = { x: down.y, y: -down.x }; // 與身體軸垂直，指向畫面右側
  const m = a.measures;
  return {
    ok, kp, shL, shR, hipL, hipR, elL, elR, wrL, wrR, knL, knR, anL, anR,
    okArm: { L: [o(5)[0], o(7)[0], o(9)[0]], R: [o(5)[1], o(7)[1], o(9)[1]] },
    okLeg: { L: [o(13)[0], o(15)[0]], R: [o(13)[1], o(15)[1]] },
    neck, pelvis, down, across, torso,
    shoulderHalf: m.shoulderWidth / 2, waistHalf: m.waistWidth / 2, hipHalf: m.hipWidth / 2,
    // MoveNet 肩點在關節中心，肩峰約在外側 1.2 倍處；輪廓量到的肩寬常包含上臂，取較小者
    seamHalf: Math.min(m.shoulderWidth / 2, (len(shL, shR) * 1.22) / 2),
    waistY: lerp(neck, pelvis, WAIST_T).y, armR: Math.max(4, len(shL, shR) * 0.14),
  };
}

/** 沿身體軸向 t（0=肩線, 1=臀線，可 > 1）時的身體半寬 */
function bodyHalfAt(B: Body, t: number) {
  if (t <= WAIST_T) return B.shoulderHalf + (B.waistHalf - B.shoulderHalf) * (t / WAIST_T);
  if (t <= 1) return B.waistHalf + (B.hipHalf - B.waistHalf) * ((t - WAIST_T) / (1 - WAIST_T));
  return B.hipHalf;
}

/** 兩腿在高度 t（臀線以下）時，需要覆蓋到的最外側半寬（洋裝、裙子下襬不可露出腿） */
function legCoverHalf(B: Body, t: number) {
  if (t <= 1) return 0;
  const legT = (t - 1) * B.torso; // 臀線以下的距離
  const at = (hip: Pt, kn: Pt, an: Pt, okKn: boolean, okAn: boolean) => {
    const thigh = okKn ? len(hip, kn) : B.torso * 0.9;
    if (legT <= thigh || !okAn) return okKn ? lerp(hip, kn, Math.min(1, legT / thigh)) : hip;
    return lerp(kn, an, Math.min(1, (legT - thigh) / Math.max(1, len(kn, an))));
  };
  const l = at(B.hipL, B.knL, B.anL, B.okLeg.L[0], B.okLeg.L[1]), r = at(B.hipR, B.knR, B.anR, B.okLeg.R[0], B.okLeg.R[1]);
  const c = lerp(B.hipL, B.hipR, 0.5);
  const off = (p: Pt) => Math.abs((p.x - c.x) * B.across.x + (p.y - c.y) * B.across.y);
  return Math.max(off(l), off(r)) + B.hipHalf * 0.3;
}

/** 沿折線（例如 肩→肘→腕）走 d 距離後的點 */
function along(pts: Pt[], d: number): Pt {
  for (let i = 0; i < pts.length - 1; i++) {
    const L = len(pts[i]!, pts[i + 1]!);
    if (d <= L || i === pts.length - 2) return lerp(pts[i]!, pts[i + 1]!, Math.min(1.15, d / Math.max(1, L)));
    d -= L;
  }
  return pts[pts.length - 1]!;
}

function upper(g: UpperAnchors, B: Body, notes: string[]): Omit<Correspondence, 'origin' | 'down'> & { origin: Pt } {
  const ease = EASE[g.kind];
  const gShW = Math.max(1, g.shoulderR[0] - g.shoulderL[0]);
  const shHalf = B.seamHalf * (g.kind === 'outer' ? 1.05 : 1.0);
  const s = (shHalf * 2) / gShW; // 衣服像素 → 畫面像素
  const lift = B.torso * 0.05;   // 肩線縫位在肩關節上方
  const top = add(B.neck, B.down, -lift);
  // 衣服上任一點 → 畫面（相似變換：以肩線中點為原點）
  const gTop: P2 = [g.cx, (g.shoulderL[1] + g.shoulderR[1]) / 2];
  const place = (gx: number, gy: number): Pt => add(add(top, B.across, (gx - gTop[0]) * s), B.down, (gy - gTop[1]) * s);
  const tOf = (gy: number) => ((gy - gTop[1]) * s + lift) / B.torso; // 對應身體軸向位置（0=肩關節線）
  const widthAt = (gy: number, gHalf: number, cover: boolean) => {
    const t = tOf(gy);
    let half = Math.max(bodyHalfAt(B, t) * ease, gHalf * s);
    if (cover) half = Math.max(half, legCoverHalf(B, t));
    return half;
  };
  const pair = (gl: P2, gr: P2, cover = false): [Pt, Pt] => {
    const gy = (gl[1] + gr[1]) / 2, c = place((gl[0] + gr[0]) / 2, gy), half = widthAt(gy, (gr[0] - gl[0]) / 2, cover);
    return [add(c, B.across, -half), add(c, B.across, half)];
  };
  const src: P2[] = [], dst: P2[] = [], labels: string[] = [];
  const push = (gs: P2, d: Pt, l: string) => { src.push(gs); dst.push(p2(d)); labels.push(l); };
  push(g.shoulderL, add(top, B.across, -shHalf), '肩');
  push(g.shoulderR, add(top, B.across, shHalf), '肩');
  const [wl, wr] = pair(g.waistL, g.waistR);
  push(g.waistL, wl, '腰'); push(g.waistR, wr, '腰');
  let [hl, hr] = pair(g.hemL, g.hemR, g.kind === 'dress');
  // 上衣／外套長度上限（臀線以下約 0.7／0.9 個軀幹長）。衣服照片斜拍、折起、方向不對時，
  // 依照片比例算出的衣長可能長到腳踝，這時限制長度並提示
  const maxT = g.kind === 'top' ? 1.7 : g.kind === 'outer' ? 1.9 : Infinity;
  const hemT = tOf((g.hemL[1] + g.hemR[1]) / 2);
  if (hemT > maxT) {
    const k = (maxT * B.torso - lift) / ((hemT * B.torso) - lift);
    const shrink = (p: Pt): Pt => add(top, { x: p.x - top.x, y: p.y - top.y }, k);
    // 只沿身體軸向縮短
    const fix = (p: Pt): Pt => { const q = shrink(p); const dx = p.x - q.x, dy = p.y - q.y; const along = dx * B.down.x + dy * B.down.y; return { x: p.x - B.down.x * along, y: p.y - B.down.y * along }; };
    hl = fix(hl); hr = fix(hr);
    const [wl2, wr2] = [fix(wl), fix(wr)];
    dst[2] = p2(wl2); dst[3] = p2(wr2);
    notes.push('依衣服照片比例算出的衣長過長（可能是照片斜拍、折起或方向不對），已自動限制長度；可用「長度」滑桿微調');
  }
  push(g.hemL, hl, '下襬'); push(g.hemR, hr, '下襬');

  // 袖子
  if (g.sleeve !== 'none' && g.cuffL && g.cuffR) {
    for (const side of ['L', 'R'] as const) {
      const gSh = side === 'L' ? g.shoulderL : g.shoulderR, gCuff = side === 'L' ? g.cuffL : g.cuffR;
      const [okS, okE, okW] = B.okArm[side];
      const sh = side === 'L' ? B.shL : B.shR, el = side === 'L' ? B.elL : B.elR, wr = side === 'L' ? B.wrL : B.wrR;
      if (!okS || !okE) { notes.push(`${side === 'L' ? '畫面左' : '畫面右'}手臂不清楚，袖子維持原形`); continue; }
      const sleeveLen = Math.hypot(gCuff[0] - gSh[0], gCuff[1] - gSh[1]) * s;
      if (g.sleeve === 'long') {
        if (!okW) { notes.push('手腕不清楚，長袖只對齊到手肘'); }
        else {
          const u = { x: sh.x - el.x, y: sh.y - el.y }, v = { x: wr.x - el.x, y: wr.y - el.y };
          const cos = (u.x * v.x + u.y * v.y) / ((Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) || 1);
          if (cos > -0.5) { notes.push('手肘彎曲較大，長袖無法完全貼合手臂'); continue; }
        }
      }
      if (g.sleeve === 'long') {
        // 衣服照片的袖子方向與手臂方向差太多（例如手臂平舉、袖子下垂）時不強拉，避免整件衣服扭曲
        const gv = { x: gCuff[0] - gSh[0], y: gCuff[1] - gSh[1] }, bv = { x: el.x - sh.x, y: el.y - sh.y };
        const c = (gv.x * bv.x + gv.y * bv.y) / ((Math.hypot(gv.x, gv.y) * Math.hypot(bv.x, bv.y)) || 1);
        if (c < Math.cos((55 * Math.PI) / 180)) { notes.push('手臂角度和衣服照片中的袖子差太多（例如手臂張開或舉起），長袖維持原形'); continue; }
      }
      const path = okW && g.sleeve === 'long' ? [sh, el, wr] : [sh, el];
      const outward = side === 'L' ? -1 : 1;
      const cuff = add(along(path, sleeveLen * 0.92), B.across, outward * B.armR * 0.8);
      push(gCuff, cuff, '袖口');
      // 袖山固定點：讓袖子從肩膀自然接出，避免肩膀出現空隙
      const shTarget = dst[side === 'L' ? 0 : 1]!;
      push([gSh[0] + (gCuff[0] - gSh[0]) * 0.35, gSh[1] + (gCuff[1] - gSh[1]) * 0.35], lerp({ x: shTarget[0], y: shTarget[1] }, cuff, 0.35), '袖');
    }
  }
  return { src, dst, labels, origin: top, notes };
}

function lower(g: LowerAnchors, B: Body, notes: string[]): Omit<Correspondence, 'origin' | 'down'> & { origin: Pt } {
  const ease = EASE[g.kind];
  // 腰頭位置：褲子約在腰與臀之間偏下，裙子偏高
  const tBand = BAND_T[g.kind];
  const bandC = lerp(B.neck, B.pelvis, tBand);
  const half = Math.max(bodyHalfAt(B, tBand) * ease, 1);
  const s = (half * 2) / Math.max(1, g.bandR[0] - g.bandL[0]);
  const gBandY = (g.bandL[1] + g.bandR[1]) / 2;
  const src: P2[] = [], dst: P2[] = [], labels: string[] = [];
  const push = (gs: P2, d: Pt, l: string) => { src.push(gs); dst.push(p2(d)); labels.push(l); };
  push(g.bandL, add(bandC, B.across, -half), '腰頭');
  push(g.bandR, add(bandC, B.across, half), '腰頭');
  const drop = (g.hemL[1] - gBandY) * s; // 衣服本身的長度（畫面像素）

  if (g.kind === 'skirt') {
    const hemC = add(bandC, B.down, drop);
    const t = tBand + drop / B.torso;
    const hHalf = Math.max(((g.hemR[0] - g.hemL[0]) / 2) * s, bodyHalfAt(B, t) * ease, legCoverHalf(B, t));
    push(g.hemL, add(hemC, B.across, -hHalf), '下襬');
    push(g.hemR, add(hemC, B.across, hHalf), '下襬');
    return { src, dst, labels, origin: bandC, notes };
  }

  // 褲管：沿各自的腿（臀→膝→踝）走「衣服本身的褲長」
  const crotchDrop = ((g.crotch?.[1] ?? gBandY) - gBandY) * s;
  const legHalf = Math.max(((g.hemR[0] - g.hemL[0]) / 4) * s, B.hipHalf * 0.32);
  for (const side of ['L', 'R'] as const) {
    const hip = side === 'L' ? B.hipL : B.hipR, kn = side === 'L' ? B.knL : B.knR, an = side === 'L' ? B.anL : B.anR;
    const [okK, okA] = B.okLeg[side];
    const start = add(hip, B.down, ((bandC.x - B.pelvis.x) * B.down.x + (bandC.y - B.pelvis.y) * B.down.y));
    const pts: Pt[] = [start];
    if (okK) pts.push(kn); else pts.push(add(hip, B.down, B.torso * 0.95));
    if (okA) pts.push(an); else { pts.push(add(pts[1]!, B.down, B.torso * 0.95)); if (g.kind === 'pants') notes.push('腳踝不清楚，褲長為推估'); }
    let p = along(pts, drop);
    // 長褲最多到腳踝下緣
    if (okA && g.kind === 'pants') { const maxD = len(start, pts[1]!) + len(pts[1]!, an) + B.torso * 0.04; if (drop > maxD) p = along(pts, maxD); }
    const outward = side === 'L' ? -1 : 1;
    push(side === 'L' ? g.hemL : g.hemR, add(p, B.across, outward * legHalf), '褲口');
  }
  if (g.crotch) push(g.crotch, add(bandC, B.down, crotchDrop), '褲襠');
  return { src, dst, labels, origin: bandC, notes };
}

/** 套用使用者手動調整（位移、大小、角度、長度），以衣服頂端中心為基準 */
function applyAdjust(dst: P2[], origin: Pt, down: Pt, a: Adjust): P2[] {
  const cos = Math.cos((a.rotate * Math.PI) / 180), sin = Math.sin((a.rotate * Math.PI) / 180);
  return dst.map(([x, y]) => {
    let vx = x - origin.x, vy = y - origin.y;
    // 長度：只沿身體軸向拉伸
    const along = vx * down.x + vy * down.y;
    vx += down.x * along * (a.length - 1); vy += down.y * along * (a.length - 1);
    vx *= a.scale; vy *= a.scale;
    return [origin.x + vx * cos - vy * sin + a.dx, origin.y + vx * sin + vy * cos + a.dy];
  });
}

export function correspondences(g: GarmentAnchors, analysis: BodyAnalysis, adjust: Adjust = NO_ADJUST): Correspondence {
  const B = bodyOf(analysis);
  const notes: string[] = [];
  const r = 'bandL' in g ? lower(g, B, notes) : upper(g, B, notes);
  return { src: r.src, dst: applyAdjust(r.dst, r.origin, B.down, adjust), labels: r.labels, origin: [r.origin.x + adjust.dx, r.origin.y + adjust.dy], down: [B.down.x, B.down.y], notes };
}

/** 身體軸向位置 t 對應的畫面 y（給合成時「臀線以下不裁切」用） */
export function bodyLine(analysis: BodyAnalysis, t: number): { p: P2; across: P2 } {
  const B = bodyOf(analysis);
  const p = lerp(B.neck, B.pelvis, t);
  return { p: [p.x, p.y], across: [B.across.x, B.across.y] };
}
