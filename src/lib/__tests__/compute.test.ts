import { describe, expect, it } from 'vitest';
import { perfFor } from '../compute';
import { DEFAULT_SETTINGS } from '../types';

describe('perfFor', () => {
  it('省電：小尺寸、粗網格、只用 CPU、降低預覽頻率', () => {
    const p = perfFor({ ...DEFAULT_SETTINGS, computeMode: 'saver' });
    expect(p.maxSide).toBe(640);
    expect(p.accelerator).toBe('wasm');
    expect(p.draftIntervalMs).toBeGreaterThanOrEqual(100);
    expect(p.grid.cols * p.grid.rows).toBeLessThan(perfFor({ ...DEFAULT_SETTINGS, computeMode: 'high' }).grid.cols * perfFor({ ...DEFAULT_SETTINGS, computeMode: 'high' }).grid.rows);
  });
  it('高品質：允許 WebGPU（實際是否可用由 Worker 偵測，不支援時自動改用 CPU）', () => {
    expect(perfFor({ ...DEFAULT_SETTINGS, computeMode: 'high' }).accelerator).toBe('webgpu');
  });
  it('使用者關閉 GPU 時一律用 CPU', () => {
    expect(perfFor({ ...DEFAULT_SETTINGS, computeMode: 'high', backend: 'wasm' }).accelerator).toBe('wasm');
  });
  it('拖曳預覽網格比最終畫面粗', () => {
    for (const m of ['high', 'balanced', 'saver'] as const) {
      const p = perfFor({ ...DEFAULT_SETTINGS, computeMode: m });
      expect(p.draftGrid.cols * p.draftGrid.rows).toBeLessThan(p.grid.cols * p.grid.rows);
    }
  });
});
