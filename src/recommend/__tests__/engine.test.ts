import { describe, expect, it } from 'vitest';
import type { Garment } from '../../lib/types';
import { colorScore, currentSeason, formalityOf, recommend, type RecommendInput } from '../engine';

let n = 0;
const G = (category: Garment['category'], color: string, extra: Partial<Garment> = {}): Garment => ({
  id: `g${++n}`, name: extra.name ?? `${color}${category}`, category, color, brand: '', size: '', seasons: [], notes: '',
  originalImageId: '', cutoutImageId: null, thumbImageId: '', createdAt: 0, updatedAt: 0, favorite: 0, ...extra,
});
const base = (garments: Garment[], o: Partial<RecommendInput> = {}): RecommendInput => ({ garments, mode: 'color', season: 'spring', occasion: 'daily', style: 'any', seed: 1, count: 5, ...o });

describe('recommend', () => {
  const tee = G('tshirt', '白色'), shirt = G('shirt', '藍色', { name: '藍色襯衫' }), jeans = G('pants', '丹寧', { name: '牛仔褲' });
  const slacks = G('pants', '黑色', { name: '黑色西褲' }), shorts = G('shorts', '卡其', { seasons: ['summer'] }), dress = G('dress', '紅色');
  const all = [tee, shirt, jeans, slacks, shorts, dress];

  it('只使用衣櫥中存在的衣服，且每組都是 上衣+下身 或 洋裝', () => {
    const r = recommend(base(all, { count: 10 }));
    const ids = new Set(all.map((g) => g.id));
    for (const x of r.items) {
      expect(x.garmentIds.every((id) => ids.has(id))).toBe(true);
      expect(!!x.dress !== (!!x.top && !!x.bottom)).toBe(true);
    }
  });
  it('衣服不足時回報原因', () => {
    expect(recommend(base([tee])).problem).toMatch(/下身/);
    expect(recommend(base([jeans])).problem).toMatch(/上衣/);
  });
  it('季節模式：夏季短褲不會出現在冬天', () => {
    const r = recommend(base(all, { mode: 'season', season: 'winter', count: 10 }));
    expect(r.items.some((x) => x.bottom?.id === shorts.id)).toBe(false);
  });
  it('正式場合：襯衫＋西褲排在 T 恤＋短褲之前', () => {
    const r = recommend(base(all, { mode: 'occasion', occasion: 'formal', count: 10 }));
    const i1 = r.items.findIndex((x) => x.top?.id === shirt.id && x.bottom?.id === slacks.id);
    const i2 = r.items.findIndex((x) => x.top?.id === tee.id && x.bottom?.id === shorts.id);
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2 === -1 || i1 < i2).toBe(true);
  });
  it('隨機模式：同樣 seed 結果相同，不同 seed 可能不同', () => {
    const a = recommend(base(all, { mode: 'random', seed: 7 })).items.map((x) => x.key);
    const b = recommend(base(all, { mode: 'random', seed: 7 })).items.map((x) => x.key);
    expect(a).toEqual(b);
  });
  it('最近推薦過的組合分數較低', () => {
    const r1 = recommend(base([tee, jeans, slacks]));
    const top = r1.items[0]!.key;
    const r2 = recommend(base([tee, jeans, slacks], { recent: [top] }));
    expect(r2.items[0]!.key).not.toBe(top);
  });
});

describe('rules', () => {
  it('配色：全中性色 / 一個亮點 / 兩件花色', () => {
    expect(colorScore([G('tshirt', '白色'), G('pants', '黑色')]).score).toBeGreaterThan(0.8);
    expect(colorScore([G('tshirt', '紅色'), G('pants', '黑色')]).score).toBeGreaterThan(0.9);
    expect(colorScore([G('tshirt', '多色'), G('skirt', '多色')]).score).toBeLessThan(0.4);
  });
  it('正式程度：西裝 > 襯衫 > T 恤 > 運動褲', () => {
    const f = (c: Garment['category'], name: string) => formalityOf(G(c, '', { name }));
    expect(f('jacket', '黑色西裝外套')).toBeGreaterThan(f('shirt', '白襯衫'));
    expect(f('shirt', '白襯衫')).toBeGreaterThan(f('tshirt', '白T'));
    expect(f('tshirt', '白T')).toBeGreaterThan(f('pants', '運動褲'));
  });
  it('目前季節（台灣月份）', () => {
    expect(currentSeason(new Date(2026, 10, 3))).toBe('autumn');
    expect(currentSeason(new Date(2026, 0, 3))).toBe('winter');
  });
});
