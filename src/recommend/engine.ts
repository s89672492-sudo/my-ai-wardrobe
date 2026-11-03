/**
 * 本機穿搭推薦規則引擎（純函式，不呼叫任何雲端 AI）。
 * 只會使用衣櫥中實際存在的衣服；每個推薦附上白話理由。
 */
import { COLORS } from '../lib/image';
import type { CategoryId, Garment, Season } from '../lib/types';

export type Occasion = 'daily' | 'work' | 'date' | 'formal' | 'sport';
export type StyleTag = 'casual' | 'formal' | 'sport';
export type Mode = 'random' | 'color' | 'season' | 'occasion';
export const OCCASION_ZH: Record<Occasion, string> = { daily: '日常休閒', work: '上班通勤', date: '約會聚會', formal: '正式場合', sport: '運動戶外' };
export const STYLE_ZH: Record<StyleTag, string> = { casual: '休閒', formal: '正式', sport: '運動' };
export const MODE_ZH: Record<Mode, string> = { random: '隨機搭配', color: '顏色搭配', season: '季節搭配', occasion: '場合搭配' };

export interface RecommendInput {
  garments: Garment[];
  mode: Mode;
  season: Season;
  occasion: Occasion;
  /** 風格偏好：休閒／正式／不限 */
  style: 'casual' | 'formal' | 'any';
  seed: number;
  count: number;
  /** 最近推薦過的組合 key（避免重複） */
  recent?: string[];
}
export interface Recommendation {
  key: string;
  top?: Garment; bottom?: Garment; dress?: Garment; outer?: Garment; shoes?: Garment; bag?: Garment;
  garmentIds: string[];
  score: number;
  reasons: string[];
  formality: number;
}
export interface RecommendResult { items: Recommendation[]; problem: string | null; /** 符合條件的組合總數 */ total: number }

const TOP: CategoryId[] = ['tshirt', 'shirt'], BOTTOM: CategoryId[] = ['pants', 'shorts', 'skirt'];

export function currentSeason(d = new Date()): Season {
  const m = d.getMonth() + 1;
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
}

/** 可重現的亂數（mulberry32） */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- 屬性 ----
const BASE_FORMALITY: Partial<Record<CategoryId, number>> = { tshirt: 0.2, shirt: 0.65, jacket: 0.5, pants: 0.55, shorts: 0.1, skirt: 0.5, dress: 0.6, shoes: 0.45, bag: 0.5 };
const KEYWORDS: [RegExp, number][] = [
  [/西裝|blazer|套裝|西褲|正裝/i, 0.92], [/襯衫|polo/i, 0.68], [/雪紡|緞面|洋裝|連身裙/i, 0.65], [/針織|毛衣|開襟/i, 0.5],
  [/牛仔|丹寧|denim/i, 0.3], [/帽t|連帽|hoodie|衛衣|大學t/i, 0.12], [/運動|瑜伽|慢跑|sport|球/i, 0.05],
];
const text = (g: Garment) => `${g.name} ${g.notes} ${g.brand}`;
const styles = (g: Garment) => (g as Garment & { styles?: StyleTag[] }).styles ?? [];

export function formalityOf(g: Garment): number {
  const st = styles(g);
  if (st.includes('formal')) return 0.88;
  if (st.includes('sport')) return 0.05;
  if (st.includes('casual')) return 0.22;
  for (const [re, v] of KEYWORDS) if (re.test(text(g))) return v;
  let f = BASE_FORMALITY[g.category] ?? 0.4;
  if (/丹寧/.test(g.color)) f -= 0.15;
  if (/黑|海軍藍|灰/.test(g.color) && g.category !== 'tshirt') f += 0.08;
  return Math.max(0, Math.min(1, f));
}
const isSport = (g: Garment) => styles(g).includes('sport') || /運動|瑜伽|慢跑|sport/i.test(text(g));

const NEUTRAL = new Set(['黑色', '白色', '灰色', '米色', '卡其', '咖啡', '海軍藍', '丹寧']);
function hueOf(label: string): number | null {
  const hex = COLORS.find((c) => c.label === label)?.hex;
  if (!hex?.startsWith('#')) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.08) return null;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** 顏色協調分數 0~1 與理由 */
export function colorScore(items: Garment[]): { score: number; reason: string } {
  const cols = items.map((g) => g.color).filter(Boolean);
  if (!cols.length) return { score: 0.6, reason: '衣服未設定顏色，無法判斷配色' };
  const multi = cols.filter((c) => c === '多色').length;
  if (multi >= 2) return { score: 0.3, reason: '兩件都是花色／多色，畫面容易太雜' };
  const accents = [...new Set(cols.filter((c) => !NEUTRAL.has(c) && c !== '多色'))];
  if (multi === 1) return accents.length ? { score: 0.55, reason: '花色搭配彩色單品，建議其他件選中性色' } : { score: 0.9, reason: '花色單品配中性色，重點清楚' };
  if (accents.length === 0) return { score: 0.82, reason: `全中性色（${[...new Set(cols)].join('、')}），簡約不出錯` };
  if (accents.length === 1) return { score: 0.95, reason: `${accents[0]}當亮點，其餘中性色襯托` };
  const hs = accents.map(hueOf).filter((h): h is number => h !== null);
  if (hs.length < 2) return { score: 0.6, reason: '配色普通' };
  let d = Math.abs(hs[0]! - hs[1]!); if (d > 180) d = 360 - d;
  if (accents.length > 2) return { score: 0.4, reason: `顏色超過兩種（${accents.join('、')}），較花俏` };
  if (d < 30) return { score: 0.85, reason: `${accents.join('、')}同色系，協調有層次` };
  if (d < 70) return { score: 0.78, reason: `${accents.join('、')}是相鄰色，柔和自然` };
  if (d > 150) return { score: 0.62, reason: `${accents.join('、')}是互補色，對比鮮明、較大膽` };
  return { score: 0.45, reason: `${accents.join('、')}撞色較強烈` };
}

const seasonOk = (g: Garment, s: Season) => !g.seasons.length || g.seasons.includes(s);
const OCC_TARGET: Record<Occasion, [number, number]> = { daily: [0.1, 0.55], work: [0.5, 0.85], date: [0.4, 0.8], formal: [0.7, 1], sport: [0, 0.25] };

export function recommend(inp: RecommendInput): RecommendResult {
  const R = rng(inp.seed);
  const S = inp.season;
  const byCat = (cats: CategoryId[]) => inp.garments.filter((g) => cats.includes(g.category));
  let tops = byCat(TOP), bottoms = byCat(BOTTOM), dresses = byCat(['dress']), outers = byCat(['jacket']);
  const shoes = byCat(['shoes']), bags = byCat(['bag']);
  if (!tops.length && !dresses.length) return { items: [], problem: '衣櫥裡需要至少一件上衣（T-shirt、襯衫）或洋裝', total: 0 };
  if (!dresses.length && !bottoms.length) return { items: [], problem: '衣櫥裡需要至少一件下身（長褲、短褲、裙子）或洋裝', total: 0 };

  // 季節過濾（季節模式或任何模式都排除明顯不合季的）
  const strict = inp.mode === 'season';
  const filt = (arr: Garment[]) => { const ok = arr.filter((g) => seasonOk(g, S)); return strict || ok.length ? ok : arr; };
  tops = filt(tops); bottoms = filt(bottoms); dresses = filt(dresses); outers = filt(outers);
  if (S === 'winter') bottoms = bottoms.filter((g) => g.category !== 'shorts' || bottoms.every((b) => b.category === 'shorts'));

  // 候選組合
  type Cand = Omit<Recommendation, 'score' | 'reasons' | 'formality' | 'key' | 'garmentIds'>;
  let cands: Cand[] = [];
  for (const t of tops) for (const b of bottoms) cands.push({ top: t, bottom: b });
  for (const d of dresses) cands.push({ dress: d });
  if (!cands.length) return { items: [], problem: `沒有適合${{ spring: '春', summer: '夏', autumn: '秋', winter: '冬' }[S]}季的組合，試試其他季節或把衣服加上季節標籤`, total: 0 };
  const total = cands.length;
  if (cands.length > 400) { for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [cands[i], cands[j]] = [cands[j]!, cands[i]!]; } cands = cands.slice(0, 400); }

  const target = inp.mode === 'occasion' ? OCC_TARGET[inp.occasion] : inp.style === 'formal' ? OCC_TARGET.work : inp.style === 'casual' ? OCC_TARGET.daily : null;
  const wantOuter = S === 'winter' || S === 'autumn' || (target !== null && target[0] >= 0.5);
  const recent = new Set(inp.recent ?? []);

  const scored: Recommendation[] = cands.map((c) => {
    const base = [c.top, c.bottom, c.dress].filter(Boolean) as Garment[];
    const reasons: string[] = [];
    // 外套：冬秋或正式時挑最搭的一件
    let outer: Garment | undefined;
    if (outers.length && (wantOuter || R() < 0.25)) {
      outer = [...outers].sort((a, b) => colorScore([...base, b]).score - colorScore([...base, a]).score)[0];
      if (S === 'summer' && outer) outer = undefined;
    }
    const core = outer ? [...base, outer] : base;
    const col = colorScore(core);
    reasons.push(col.reason);
    const form = core.reduce((s, g) => s + formalityOf(g), 0) / core.length;
    const spread = Math.max(...core.map(formalityOf)) - Math.min(...core.map(formalityOf));
    let fit = 1 - Math.min(1, spread * 0.8);
    if (spread > 0.5) reasons.push('單品正式程度落差大（例如襯衫配運動褲），風格較不一致');
    let occ = 0.7;
    if (target) {
      const [lo, hi] = target;
      occ = form < lo ? Math.max(0, 1 - (lo - form) * 2.5) : form > hi ? Math.max(0, 1 - (form - hi) * 2.5) : 1;
      if (inp.mode === 'occasion') {
        if (inp.occasion === 'sport' && !core.some(isSport)) occ *= 0.5;
        reasons.push(occ > 0.8 ? `正式程度適合${OCCASION_ZH[inp.occasion]}` : `對${OCCASION_ZH[inp.occasion]}來說${form < lo ? '太休閒' : '太正式'}`);
      } else reasons.push(occ > 0.8 ? `符合${inp.style === 'formal' ? '正式' : '休閒'}風格` : `不太像${inp.style === 'formal' ? '正式' : '休閒'}風格`);
    }
    const seasonAll = core.every((g) => seasonOk(g, S));
    const seasonPts = seasonAll ? 1 : 0.4;
    if (core.some((g) => g.seasons.length)) reasons.push(seasonAll ? `適合${{ spring: '春', summer: '夏', autumn: '秋', winter: '冬' }[S]}天` : '有單品不屬於這個季節');
    if (outer && (S === 'winter' || S === 'autumn')) reasons.push(`${{ autumn: '秋', winter: '冬' }[S as 'autumn' | 'winter']}天加一件外套保暖`);
    const fav = core.filter((g) => g.favorite).length / core.length;
    if (fav > 0) reasons.push('包含你收藏的單品');
    const key = core.map((g) => g.id).sort().join('+');
    const novelty = recent.has(key) ? 0 : 1;

    const w = inp.mode === 'color' ? { col: 0.55, occ: 0.15, sea: 0.15 } : inp.mode === 'season' ? { col: 0.3, occ: 0.15, sea: 0.4 } : inp.mode === 'occasion' ? { col: 0.25, occ: 0.5, sea: 0.1 } : { col: 0.35, occ: 0.2, sea: 0.25 };
    let score = w.col * col.score + w.occ * occ * fit + w.sea * seasonPts + 0.05 * fav + 0.05 * novelty + (1 - w.col - w.occ - w.sea - 0.1) * fit;
    if (inp.mode === 'random') score = score * 0.4 + R() * 0.6;
    // 最近推薦過的組合大幅降分，「換一組」才會真的換
    if (!novelty) score -= 0.25;

    // 配件：顏色最搭的鞋子、包包
    const acc = (arr: Garment[]) => (arr.length ? [...arr.filter((g) => seasonOk(g, S))].sort((a, b) => colorScore([...core, b]).score - colorScore([...core, a]).score)[0] : undefined);
    const rec: Recommendation = { key, ...c, outer, shoes: acc(shoes), bag: acc(bags), garmentIds: [], score, reasons, formality: form };
    rec.garmentIds = [rec.outer, rec.top, rec.dress, rec.bottom, rec.shoes, rec.bag].filter(Boolean).map((g) => g!.id);
    return rec;
  });

  // 依分數排序並保持多樣性：同一件衣服最多出現 2 次
  scored.sort((a, b) => b.score - a.score);
  const used = new Map<string, number>();
  const items: Recommendation[] = [];
  for (const r of scored) {
    const core = [r.top, r.bottom, r.dress].filter(Boolean) as Garment[];
    if (core.some((g) => (used.get(g.id) ?? 0) >= 2)) continue;
    items.push(r);
    core.forEach((g) => used.set(g.id, (used.get(g.id) ?? 0) + 1));
    if (items.length >= inp.count) break;
  }
  if (items.length < inp.count) for (const r of scored) { if (items.length >= inp.count) break; if (!items.includes(r)) items.push(r); }
  return { items, problem: null, total };
}
