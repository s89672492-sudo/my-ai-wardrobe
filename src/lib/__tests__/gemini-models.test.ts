import { describe, expect, it } from 'vitest';
import { rankModels } from '../cloud-tryon';

const list = (...names: string[]) => names.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] }));

describe('automatic Gemini model choice', () => {
  const models = [
    ...list('gemini-2.0-flash', 'gemini-3-flash-preview', 'gemini-3-flash', 'gemini-3-pro', 'gemini-3-flash-lite', 'gemini-3-pro-image-preview', 'gemini-3-flash-image', 'gemini-2.5-flash-preview-tts', 'gemini-live-2.5-flash', 'gemma-3-27b-it'),
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/imagen-4.0-generate-001', supportedGenerationMethods: ['predict'] },
  ];
  it('text: stable flash, newest first; never image/tts/live/embedding models', () => {
    const r = rankModels(models, 'text');
    expect(r[0]).toBe('gemini-3-flash');
    expect(r).not.toContain('gemini-3-flash-image');
    expect(r.some((n) => /tts|live|embedding|gemma/.test(n))).toBe(false);
    expect(r.indexOf('gemini-3-flash-preview')).toBeGreaterThan(r.indexOf('gemini-2.0-flash'));
  });
  it('image: only image-capable gemini models, stable flash first', () => {
    expect(rankModels(models, 'image')).toEqual(['gemini-3-flash-image', 'gemini-3-pro-image-preview']);
  });
  it('empty when the key has no suitable model', () => {
    expect(rankModels(list('gemini-3-flash'), 'image')).toEqual([]);
  });
});
