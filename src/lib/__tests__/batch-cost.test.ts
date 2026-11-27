import { describe, expect, it } from 'vitest';
import { costPerItem, formatNT } from '../batch';

describe('batch cost estimate', () => {
  const base = { redoCutout: true, redoJudge: true };
  it('free when everything runs on the phone', () => {
    expect(costPerItem({ kind: 'add', cutout: 'local', judge: 'local', ...base })).toBe(0);
    expect(formatNT(0)).toBe('NT$0（免費）');
  });
  it('adds cutout and judge costs for new garments', () => {
    expect(costPerItem({ kind: 'add', cutout: 'gemini-redraw', judge: 'gemini', ...base })).toBeCloseTo(1.35);
    expect(200 * costPerItem({ kind: 'add', cutout: 'gemini-mask', judge: 'gemini', ...base })).toBeCloseTo(20);
    expect(formatNT(260)).toBe('約 NT$260');
  });
  it('only counts the parts being redone', () => {
    expect(costPerItem({ kind: 'redo', cutout: 'gemini-redraw', judge: 'gemini', redoCutout: false, redoJudge: true })).toBeCloseTo(0.05);
    expect(costPerItem({ kind: 'redo', cutout: 'gemini-redraw', judge: 'gemini', redoCutout: true, redoJudge: false })).toBeCloseTo(1.3);
  });
});
