import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/ui';
import { modelsCached } from '../ai/assets';
import { countAll } from '../lib/db';
import { readMetrics, summarize, type MetricName } from '../lib/metrics';
import { formatMB, getStorageInfo, isStandalone, useOnline, type StorageInfo } from '../lib/platform';
import { resolveMode } from '../lib/compute';
import { useSettings } from '../lib/settings';

/**
 * 實機驗收（Phase 10）：
 * - 自動區：讀取這支手機的實際狀態與最近幾次 AI / 合成的真實耗時
 * - 手動區：使用者逐項操作後標記「通過 / 有問題 / 略過」
 * - 複製報告：純文字（不含照片），貼回對話即可
 */
type Mark = 'pass' | 'fail' | 'skip';
interface ItemState { s?: Mark; note?: string }
const KEY = 'wardrobe-acceptance-v1';

const GROUPS: { title: string; items: { id: string; text: string; how?: string }[] }[] = [
  { title: '安裝與開啟', items: [
    { id: 'open', text: '用 Safari 開啟網址，首頁正常顯示' },
    { id: 'install', text: '加入主畫面後，從主畫面圖示開啟是全螢幕（沒有網址列）', how: 'Safari 下方「分享」→「加入主畫面」' },
    { id: 'icon', text: '主畫面圖示與名稱「AI 衣櫥」正確' },
  ] },
  { title: 'AI 模型與離線', items: [
    { id: 'download', text: '設定 →「下載 AI 模型」完成，顯示「已下載」' },
    { id: 'offline', text: '開啟飛航模式後，從主畫面開啟 App，可瀏覽衣櫥與試穿' },
    { id: 'offlineAI', text: '飛航模式下仍可新增衣服並 AI 去背' },
  ] },
  { title: '衣櫥', items: [
    { id: 'camera', text: '用相機拍一件衣服（建議平放、背景單純），AI 去背結果可接受' },
    { id: 'album', text: '從相簿選一張照片新增（iPhone 預設 HEIC 格式）' },
    { id: 'brush', text: '去背的「擦除 / 補回」筆刷用手指操作順手' },
    { id: 'edit', text: '編輯衣服名稱、分類、顏色後儲存；刪除一件衣服' },
  ] },
  { title: '試穿', items: [
    { id: 'person', text: '新增一張全身照（正面站立、手自然放下），人體辨識成功' },
    { id: 'tryTop', text: '試穿一件上衣，位置與大小大致合理', how: '不合理的話請截圖給我' },
    { id: 'layers', text: '疊穿上衣＋褲子（＋外套），拖曳與縮放調整時不會明顯卡頓' },
    { id: 'saveTry', text: '儲存試穿、收藏穿搭，之後能在「穿搭」頁看到' },
  ] },
  { title: '推薦', items: [
    { id: 'rec', text: '「穿搭」→「推薦」出現組合，按「試穿」可以直接試穿' },
  ] },
  { title: '資料與備份', items: [
    { id: 'export', text: '設定 → 備份 →「匯出備份」，並存到「檔案」App' },
    { id: 'import', text: '在 Safari 分頁（不是主畫面 App）匯入同一份備份，衣服與試穿都在', how: 'iPhone 上主畫面 App 與 Safari 是分開的儲存空間，剛好可以用來測還原，不必刪除資料' },
    { id: 'persist', text: '隔天再從主畫面開啟，資料都還在' },
  ] },
  { title: '穩定性', items: [
    { id: 'noCrash', text: '連續操作約 10 分鐘，沒有閃退或畫面突然重新載入' },
    { id: 'bg', text: '切到其他 App 幾分鐘後回來，App 正常，AI 功能仍可使用' },
    { id: 'update', text: '下次我部署新版後，回到 App 會出現「有新版本可以使用」，按更新後設定頁的部署代號改變', how: '這項可以之後再測' },
  ] },
];
const ALL = GROUPS.flatMap((g) => g.items);

/** 參考標準：超過代表在這支手機上偏慢，需要調整 */
const METRICS: { name: MetricName; label: string; goodMs: number }[] = [
  { name: 'cutout', label: 'AI 去背（含首次載入模型）', goodMs: 8000 },
  { name: 'analyze', label: 'AI 人體辨識', goodMs: 5000 },
  { name: 'compose', label: '試穿合成（完整畫面）', goodMs: 1000 },
  { name: 'composeDraft', label: '試穿拖曳預覽（每一格）', goodMs: 150 },
];

function loadMarks(): Record<string, ItemState> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, ItemState>; } catch { return {}; }
}

function browserOf(ua: string) {
  const ios = ua.match(/OS (\d+)_(\d+)(?:_(\d+))? like Mac/);
  const os = ios ? `iOS ${ios[1]}.${ios[2]}${ios[3] ? '.' + ios[3] : ''}` : (ua.match(/Android [\d.]+/)?.[0] ?? (/Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : '其他系統'));
  const br = /CriOS/.test(ua) ? 'iPhone 版 Chrome' : /FxiOS/.test(ua) ? 'iPhone 版 Firefox' : /EdgiOS|EdgA|Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung 瀏覽器' : /Chrome\/(\d+)/.test(ua) ? `Chrome ${ua.match(/Chrome\/(\d+)/)![1]}` : /Version\/([\d.]+).*Safari/.test(ua) ? `Safari ${ua.match(/Version\/([\d.]+)/)![1]}` : '其他瀏覽器';
  return `${os} · ${br}`;
}

export function Acceptance() {
  const { settings } = useSettings();
  const online = useOnline();
  const [marks, setMarks] = useState<Record<string, ItemState>>(loadMarks);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof countAll>> | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const metrics = useMemo(readMetrics, []);

  useEffect(() => {
    void getStorageInfo().then(setStorage);
    void modelsCached().then(setCached);
    void countAll().then(setCounts).catch(() => setCounts(null));
    if (navigator.onLine) {
      // 只連到本網站自己的 version.json，確認手機上是否為最新部署
      void fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null)).then((v: { build?: string } | null) => setLatest(v?.build ?? null)).catch(() => setLatest(null));
    }
  }, []);

  function setMark(id: string, patch: ItemState) {
    setMarks((m) => {
      const next = { ...m, [id]: { ...m[id], ...patch } };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  const sw = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  const mode = resolveMode(settings);
  const auto: [string, string, boolean | null][] = [
    ['裝置', browserOf(navigator.userAgent), null],
    ['版本', `${__APP_VERSION__}（${__BUILD_ID__}）${latest ? (latest === __BUILD_ID__ ? ' · 已是最新' : ` · 線上最新為 ${latest}，請更新`) : ''}`, latest ? latest === __BUILD_ID__ : null],
    ['從主畫面開啟', isStandalone() ? '是' : '否（在瀏覽器分頁中）', isStandalone()],
    ['離線功能（Service Worker）', sw ? '已啟用' : '尚未啟用（重新開啟一次 App 即可）', sw],
    ['AI 模型', cached === null ? '檢查中' : cached ? '已下載，可離線使用' : '尚未全部下載', cached],
    ['運算模式', `${{ high: '高品質', balanced: '平衡', saver: '省電' }[mode.mode]}（${mode.reason}）`, null],
    ['儲存空間', storage ? `已用 ${formatMB(storage.usageMB)} / 上限約 ${formatMB(storage.quotaMB)}` : '瀏覽器未提供', null],
    ['永久儲存', storage ? (storage.persisted ? '已授權（瀏覽器不會自動清除）' : '未授權（iPhone 從主畫面開啟較不會被清除）') : '—', storage?.persisted ?? null],
    ['網路', online ? '連線中' : '離線', null],
    ['資料', counts ? `衣服 ${counts.garments} 件 · 全身照 ${counts.persons} 張 · 試穿 ${counts.tryons} 筆 · 穿搭 ${counts.outfits} 組` : '—', null],
  ];
  const perf = METRICS.map((m) => ({ ...m, s: summarize(metrics[m.name]) }));
  const done = ALL.filter((i) => marks[i.id]?.s).length;

  function report() {
    const lines = [
      `My AI Wardrobe 實機驗收報告（${new Date().toLocaleString('zh-TW', { hour12: false })}）`,
      '照片不包含在報告中。',
      '',
      '【自動檢查】',
      ...auto.map(([k, v]) => `- ${k}：${v}`),
      '',
      '【這支手機的實際速度】（最近幾次的中位數，範圍）',
      ...perf.map((p) => `- ${p.label}：${p.s ? `${p.s.median} ms（${p.s.min}–${p.s.max} ms，${p.s.n} 次；最近一次 ${p.s.last.detail ?? ''}）` : '尚未使用'}`),
      '',
      `【手動檢查】${done} / ${ALL.length} 項已填`,
      ...GROUPS.flatMap((g) => [`〈${g.title}〉`, ...g.items.map((i) => {
        const m = marks[i.id];
        const s = m?.s === 'pass' ? '✅ 通過' : m?.s === 'fail' ? '❌ 有問題' : m?.s === 'skip' ? '➖ 略過' : '⬜ 未測';
        return `${s} ${i.text}${m?.note ? `\n    說明：${m.note}` : ''}`;
      })]),
    ];
    return lines.join('\n');
  }

  async function copy() {
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
      setMsg('報告已複製，請貼到與 Claude 的對話中');
    } catch {
      // 部分瀏覽器不允許寫入剪貼簿：改為顯示文字讓使用者手動複製
      setMsg(null);
      const w = document.getElementById('report-text') as HTMLTextAreaElement | null;
      if (w) { w.value = text; w.hidden = false; w.select(); }
    }
    setTimeout(() => setMsg(null), 3000);
  }

  function reset() {
    if (!confirm('清除所有手動勾選的結果？（不影響衣櫥資料）')) return;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    setMarks({});
  }

  return (
    <div className="page accept">
      <PageHeader title="實機驗收" subtitle={`已填 ${done} / ${ALL.length} 項`} back="/settings" />
      <p className="muted">在這支手機上逐項操作，標記結果後按最下方「複製報告」，貼回對話給我。報告只有文字，不含任何照片。</p>

      <h3 className="section-title">自動檢查</h3>
      <div className="card">
        <dl className="accept-auto">
          {auto.map(([k, v, good]) => <div key={k}><dt>{k}</dt><dd>{good === true ? '✅ ' : good === false ? '⚠️ ' : ''}{v}</dd></div>)}
        </dl>
      </div>

      <h3 className="section-title">這支手機的實際速度</h3>
      <div className="card">
        <p className="muted">使用 App 時自動記錄最近 20 次的耗時。還沒用過的功能會顯示「尚未使用」。</p>
        <dl className="accept-auto">
          {perf.map((p) => (
            <div key={p.name}>
              <dt>{p.label}</dt>
              <dd>{p.s ? <>{p.s.median <= p.goodMs ? '✅' : '⚠️'} 約 {p.s.median >= 1000 ? `${(p.s.median / 1000).toFixed(1)} 秒` : `${p.s.median} ms`}<small>（{p.s.n} 次，{p.s.min}–{p.s.max} ms）</small></> : '尚未使用'}</dd>
            </div>
          ))}
        </dl>
      </div>

      {GROUPS.map((g) => (
        <section key={g.title}>
          <h3 className="section-title">{g.title}</h3>
          <div className="card accept-list">
            {g.items.map((i) => {
              const m = marks[i.id] ?? {};
              return (
                <div key={i.id} className="accept-item">
                  <p>{i.text}{i.how && <small>{i.how}</small>}</p>
                  <div className="accept-marks" role="radiogroup" aria-label={i.text}>
                    {([['pass', '通過'], ['fail', '有問題'], ['skip', '略過']] as const).map(([k, l]) => (
                      <button key={k} role="radio" aria-checked={m.s === k} className={`chip ${m.s === k ? `on ${k}` : ''}`} onClick={() => setMark(i.id, { s: m.s === k ? undefined : k })}>{l}</button>
                    ))}
                  </div>
                  {m.s === 'fail' && <input className="input" placeholder="哪裡有問題？（例如：袖子跑到肩膀上）" value={m.note ?? ''} onChange={(e) => setMark(i.id, { note: e.target.value })} />}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {msg && <div className="alert alert-ok" role="status">{msg}</div>}
      <textarea id="report-text" className="input" rows={10} hidden readOnly aria-label="驗收報告" />
      <button className="btn btn-primary" onClick={() => void copy()}>複製報告（不含照片）</button>
      <button className="link-btn" onClick={reset}>清除勾選結果</button>
    </div>
  );
}
