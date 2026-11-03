/**
 * 本機效能紀錄：記下最近幾次 AI 去背、人體辨識、試穿合成在「這支手機」上花的時間，
 * 供「實機驗收」頁顯示真實數據。只存數字（不含照片），只存在這支手機的瀏覽器。
 */
export type MetricName = 'cutout' | 'analyze' | 'compose' | 'composeDraft';
export interface MetricEntry { ms: number; at: number; detail?: string }
const KEY = 'wardrobe-metrics-v1';
const MAX = 20;

function load(): Partial<Record<MetricName, MetricEntry[]>> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<MetricName, MetricEntry[]>>; } catch { return {}; }
}

const lastWrite: Partial<Record<MetricName, number>> = {};

export function recordMetric(name: MetricName, ms: number, detail?: string) {
  // 拖曳預覽每秒會執行很多次，最多每秒記一筆
  const now = Date.now();
  if (name === 'composeDraft' && now - (lastWrite[name] ?? 0) < 1000) return;
  lastWrite[name] = now;
  try {
    const all = load();
    all[name] = [...(all[name] ?? []), { ms: Math.round(ms), at: Date.now(), detail }].slice(-MAX);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* 私密瀏覽或空間不足：不影響功能 */ }
}

export function readMetrics() { return load(); }
export function clearMetrics() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

export function summarize(list: MetricEntry[] | undefined) {
  if (!list?.length) return null;
  const s = list.map((e) => e.ms).sort((a, b) => a - b);
  return { n: s.length, median: s[s.length >> 1]!, min: s[0]!, max: s[s.length - 1]!, last: list[list.length - 1]! };
}
