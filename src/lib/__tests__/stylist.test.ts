import { describe, expect, it } from 'vitest';
import { parseStylistReply } from '../cloud-tryon';

describe('parseStylistReply', () => {
  it('extracts recommended refs and strips the tag', () => {
    const r = parseStylistReply('約會可以穿 #2 蕾絲背心配 #5 牛仔褲。\n[[推薦:#2,#5,#2]]');
    expect(r.refs).toEqual(['#2', '#5']);
    expect(r.body).toBe('約會可以穿 #2 蕾絲背心配 #5 牛仔褲。');
  });
  it('handles no recommendation', () => {
    expect(parseStylistReply('你的衣櫥還缺外套。[[推薦:]]').refs).toEqual([]);
    expect(parseStylistReply('沒有標記').refs).toEqual([]);
  });
});
