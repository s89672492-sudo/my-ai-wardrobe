import { describe, expect, it } from 'vitest';
import { planLayers, selectInto } from '../outfit';

describe('selectInto', () => {
  it('同位置替換', () => {
    expect(selectInto({ top: 'a' }, 'top', 'b').next).toEqual({ top: 'b' });
  });
  it('選洋裝會移除上衣與下身，保留外套', () => {
    const r = selectInto({ top: 'a', bottom: 'b', outer: 'c' }, 'dress', 'd');
    expect(r.next).toEqual({ outer: 'c', dress: 'd' });
    expect(r.removed.sort()).toEqual(['bottom', 'top']);
  });
  it('選上衣會移除洋裝', () => {
    expect(selectInto({ dress: 'd', outer: 'c' }, 'top', 'a').next).toEqual({ outer: 'c', top: 'a' });
  });
});

describe('planLayers', () => {
  it('預設順序：下身 → 上衣 → 外套', () => {
    expect(planLayers({ bottom: 'pants', top: 'top', outer: 'outer' }, { tucked: false, openFront: false }).map((l) => l.slot)).toEqual(['bottom', 'top', 'outer']);
  });
  it('上衣紮進：上衣在下身之下，且在腰頭下方截斷', () => {
    const p = planLayers({ bottom: 'pants', top: 'top' }, { tucked: true, openFront: false });
    expect(p.map((l) => l.slot)).toEqual(['top', 'bottom']);
    expect(p[0]!.cutBelowT).toBeCloseTo(0.88);
  });
  it('沒有下身時「紮進」不生效', () => {
    const p = planLayers({ top: 'top' }, { tucked: true, openFront: false });
    expect(p[0]!.cutBelowT).toBeNull();
  });
  it('裙子的腰頭較高', () => {
    expect(planLayers({ bottom: 'skirt', top: 'top' }, { tucked: true, openFront: false })[0]!.cutBelowT).toBeCloseTo(0.78);
  });
  it('外套敞開只作用在外套', () => {
    const p = planLayers({ dress: 'dress', outer: 'outer' }, { tucked: false, openFront: true });
    expect(p.find((l) => l.slot === 'outer')!.openFront).toBe(true);
    expect(p.find((l) => l.slot === 'dress')!.openFront).toBe(false);
  });
});
