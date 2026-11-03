import { describe, expect, it } from 'vitest';
import { TPS } from '../tps';

describe('TPS', () => {
  it('通過所有控制點', () => {
    const src = [[0, 0], [100, 0], [0, 100], [100, 100], [50, 50]] as const;
    const dst = [[10, 5], [120, 0], [0, 130], [110, 110], [60, 70]] as const;
    const t = new TPS(src, dst);
    src.forEach((p, i) => { const q = t.eval(p); expect(q[0]).toBeCloseTo(dst[i]![0], 6); expect(q[1]).toBeCloseTo(dst[i]![1], 6); });
  });
  it('純仿射對應時整體為仿射（縮放 + 平移）', () => {
    const src = [[0, 0], [100, 0], [0, 100], [100, 100]] as const;
    const t = new TPS(src, src.map(([x, y]) => [x * 2 + 5, y * 2 - 3] as const));
    const q = t.eval([37, 81]);
    expect(q[0]).toBeCloseTo(79, 6); expect(q[1]).toBeCloseTo(159, 6);
  });
  it('共線控制點拋出可讀錯誤', () => {
    expect(() => new TPS([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 1], [2, 2]])).toThrow(/共線/);
  });
});
