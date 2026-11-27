import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { defaultMethods, ProcessOptions } from '../components/ProcessOptions';
import { cancelCutout, releaseCutoutModel } from '../ai/cutout';
import { releaseClassifier } from '../ai/garment-classify';
import { clearJob, costPerItem, createAddJob, formatNT, getJob, MAX_BATCH, retryFailed, runJob, updateJob, type BatchJob, type BatchJobItem } from '../lib/batch';
import { getGeminiKey } from '../lib/cloud-tryon';
import { acceleratorFor } from '../lib/compute';
import { href, navigate } from '../lib/router';
import { useSettings } from '../lib/settings';
import { CATEGORIES, type CutoutMethod, type Garment, type JudgeMethod } from '../lib/types';
import { getGarment } from '../lib/garments';
import { useImageUrl } from '../lib/useImageUrl';

type WakeLock = { release: () => Promise<void> };

/**
 * 批次處理頁：一次新增多件（最多 200 張）或重新處理勾選的舊衣服。
 * 待處理清單存在這支手機，中途離開後回來可以從第 N 張繼續。
 */
export function BatchAdd() {
  const { settings } = useSettings();
  const [hasKey] = useState(() => !!getGeminiKey());
  const defaults = defaultMethods(settings, hasKey);
  const [cutout, setCutout] = useState<CutoutMethod>(defaults.cutout);
  const [judge, setJudge] = useState<JudgeMethod>(defaults.judge);
  const [files, setFiles] = useState<File[] | null>(null);
  const [job, setJob] = useState<BatchJob | null | undefined>(undefined);
  const [items, setItems] = useState<BatchJobItem[]>([]);
  const [stages, setStages] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [preparing, setPreparing] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const methodsLoaded = useRef(false);

  async function reload() {
    const j = await getJob();
    setJob(j?.job ?? null);
    setItems(j?.items ?? []);
    if (j && !j.job.started && !methodsLoaded.current) { setCutout(j.job.cutout); setJudge(j.job.judge); }
    methodsLoaded.current = true;
  }
  useEffect(() => {
    void reload();
    return () => { abort.current?.abort(); cancelCutout(); void releaseCutoutModel(); void releaseClassifier(); };
  }, []);

  const pending = items.filter((i) => i.status === 'pending');
  const doneCount = items.length - pending.length;

  async function run() {
    setErr(null); setRunning(true); setStages({});
    abort.current = new AbortController();
    let lock: WakeLock | null = null;
    try { lock = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } }).wakeLock?.request('screen') ?? null; } catch { /* 不支援 */ }
    try {
      await runJob({
        accelerator: acceleratorFor(settings),
        signal: abort.current.signal,
        onStage: (id, s) => setStages((m) => ({ ...m, [id]: s })),
        onItem: (it) => setItems((all) => all.map((x) => (x.id === it.id ? it : x))),
      });
    } catch (e) { setErr(`已暫停：${(e as Error).message} 修正後按「繼續」，做好的不會重做。`); }
    try { await lock?.release(); } catch { /* ignore */ }
    abort.current = null;
    setRunning(false);
    void releaseCutoutModel();
    await reload();
  }

  function confirmCost(n: number, j: Pick<BatchJob, 'kind' | 'redoCutout' | 'redoJudge'>) {
    const cost = n * costPerItem({ ...j, cutout, judge });
    if (cost === 0) return true;
    return confirm(`會把 ${n} 張衣服照片傳到 Google（Gemini）處理，預估${formatNT(cost)}，由你的 Google 帳戶支付。開始後不能退費，要繼續嗎？`);
  }

  async function startAdd() {
    if (!files?.length || !confirmCost(Math.min(files.length, MAX_BATCH), { kind: 'add', redoCutout: true, redoJudge: true })) return;
    setErr(null); setPreparing(0);
    try {
      await createAddJob(files, { cutout, judge }, setPreparing);
      setFiles(null);
      await reload();
    } catch (e) { setErr((e as Error).message); setPreparing(null); return; }
    setPreparing(null);
    await run();
  }

  async function startRedo() {
    if (!job) return;
    if (!job.redoCutout && !job.redoJudge) { setErr('請至少選一項要重新處理的內容。'); return; }
    if (!confirmCost(pending.length, job)) return;
    await updateJob({ started: true, cutout, judge });
    await reload();
    await run();
  }

  async function finish(to: 'wardrobe' | 'again') {
    await clearJob();
    if (to === 'wardrobe') navigate('/wardrobe'); else { setFiles(null); await reload(); }
  }

  async function discard() {
    if (!confirm(`放棄剩下的 ${pending.length} 件？已經做好的會保留在衣櫥。`)) return;
    await clearJob();
    await reload();
  }

  if (job === undefined) return <div className="page"><PageHeader title="一次處理多件" back="/wardrobe" /></div>;

  // ---------- 還沒有工作：選照片 ----------
  if (!job) {
    const n = Math.min(files?.length ?? 0, MAX_BATCH);
    return (
      <div className="page">
        <PageHeader title="一次新增多件" subtitle={`從相簿選多張衣服照片（最多 ${MAX_BATCH} 張）`} back="/wardrobe/new" />
        <ProcessOptions name="batch" hasKey={hasKey} cutout={cutout} judge={judge} onCutout={setCutout} onJudge={setJudge} />
        {preparing !== null ? (
          <div className="card">
            <p><span className="spinner" /> 先把照片存到手機（{preparing} / {n}）…</p>
            <div className="meter" aria-label="準備進度"><div style={{ width: `${(preparing / Math.max(1, n)) * 100}%` }} /></div>
          </div>
        ) : files?.length ? (
          <div className="card batch-confirm">
            <p>已選 <b>{n}</b> 張{files.length > MAX_BATCH ? `（一次最多 ${MAX_BATCH} 張，超過的不會處理）` : ''}</p>
            <p className="batch-cost">預估費用：<b>{formatNT(n * costPerItem({ kind: 'add', cutout, judge, redoCutout: true, redoJudge: true }))}</b></p>
            <button className="btn btn-primary" onClick={() => void startAdd()}>開始處理</button>
            <button className="link-btn" onClick={() => setFiles(null)}>重新選照片</button>
          </div>
        ) : (
          <label className="pick-btn">
            <Icon name="image" size={34} /><b>選擇多張照片</b><span>一次最多 {MAX_BATCH} 張</span>
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          </label>
        )}
        {err && <div className="alert alert-err" role="alert">{err}</div>}
        <ul className="tips">
          <li>每張照片只拍一件衣服，衣服放在畫面中間</li>
          <li>做好一件就存一件，中途離開回來可以接著做</li>
          <li>處理時請停留在這個畫面，並保持螢幕亮著</li>
        </ul>
      </div>
    );
  }

  // ---------- 重新處理：還沒開始，選要重做什麼 ----------
  if (!job.started) {
    const per = costPerItem({ ...job, cutout, judge });
    return (
      <div className="page">
        <PageHeader title="重新處理" subtitle={`已選 ${items.length} 件衣服`} back="/wardrobe" />
        <div className="card options">
          <label className="option toggle"><span><b>重新去背</b><small>用原本的照片重新去背，覆蓋現在的去背圖</small></span>
            <input type="checkbox" role="switch" checked={job.redoCutout} onChange={(e) => { setJob({ ...job, redoCutout: e.target.checked }); void updateJob({ redoCutout: e.target.checked }); }} /></label>
          <label className="option toggle"><span><b>重新判斷</b><small>種類、顏色{judge === 'gemini' ? '、季節、風格、名稱' : ''}，直接覆蓋</small></span>
            <input type="checkbox" role="switch" checked={job.redoJudge} onChange={(e) => { setJob({ ...job, redoJudge: e.target.checked }); void updateJob({ redoJudge: e.target.checked }); }} /></label>
        </div>
        <ProcessOptions name="redo" hasKey={hasKey} cutout={job.redoCutout ? cutout : undefined} judge={job.redoJudge ? judge : undefined} onCutout={setCutout} onJudge={setJudge} />
        <p className="batch-cost center">預估費用：<b>{formatNT(items.length * per)}</b></p>
        {err && <div className="alert alert-err" role="alert">{err}</div>}
        <button className="btn btn-primary" onClick={() => void startRedo()}>開始重新處理</button>
        <button className="link-btn" onClick={() => void finish('wardrobe')}>取消</button>
        <p className="muted small-note center">原始照片一定會保留，之後還能在衣服頁重新去背。</p>
      </div>
    );
  }

  // ---------- 處理中／繼續／完成 ----------
  const added = items.filter((i) => i.status === 'added' || i.status === 'updated').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const remainingCost = pending.length * costPerItem(job);
  return (
    <div className="page">
      <PageHeader title={job.kind === 'add' ? '一次新增多件' : '重新處理'} subtitle={`${doneCount} / ${items.length} 件已處理`} back="/wardrobe" />
      <div className="meter" aria-label="處理進度"><div style={{ width: `${(doneCount / Math.max(1, items.length)) * 100}%` }} /></div>
      {err && <div className="alert alert-err" role="alert">{err}</div>}
      {running ? (
        <button className="btn" onClick={() => { abort.current?.abort(); cancelCutout(); }}>暫停（做好的會保留，之後可以繼續）</button>
      ) : pending.length > 0 ? (
        <div className="card batch-resume">
          <p>還有 <b>{pending.length}</b> 件沒處理完{remainingCost > 0 ? `（剩下預估${formatNT(remainingCost)}）` : ''}。</p>
          <button className="btn btn-primary" onClick={() => void run()}>從第 {doneCount + 1} 件繼續</button>
          <button className="link-btn" onClick={() => void discard()}>放棄剩下的</button>
        </div>
      ) : (
        <div className="card batch-done">
          <p>完成！{job.kind === 'add' ? `加入 ${added} 件衣服` : `更新 ${added} 件衣服`}{failed ? `，${failed} 件失敗` : ''}。點衣服可以修改。</p>
          {failed > 0 && <button className="btn" onClick={() => void retryFailed().then(reload).then(run)}>重試失敗的 {failed} 件</button>}
          <button className="btn btn-primary" onClick={() => void finish('wardrobe')}>完成，回到衣櫥</button>
          {job.kind === 'add' && <button className="link-btn" onClick={() => void finish('again')}>再選一批</button>}
        </div>
      )}
      <ul className="batch-list card">
        {items.map((it) => <BatchRow key={it.id} it={it} stage={running ? stages[it.id] : undefined} />)}
      </ul>
    </div>
  );
}

function BatchRow({ it, stage }: { it: BatchJobItem; stage?: string }) {
  const [g, setG] = useState<Garment | null>(null);
  const id = it.resultId ?? it.garmentId;
  useEffect(() => { if (id) void getGarment(id).then((x) => setG(x ?? null)); }, [id, it.status]);
  const url = useImageUrl(g?.thumbImageId ?? null);
  const label = g ? CATEGORIES.find((c) => c.id === g.category)?.label : '';
  const note = [
    it.judged === 'gemini' ? 'Gemini 判斷' : it.judged === 'local' ? `AI 判斷：${label}` : it.judged === 'none' ? '分類請自行確認' : '',
    it.cutoutOk === false ? (it.status === 'updated' ? '去背沒成功，保留原本的' : '未去背') : '',
  ].filter(Boolean).join('・');
  const body = it.status === 'pending'
    ? <span className="muted">{stage ? <><span className="spinner" /> {stage}</> : `${g?.name ? `${g.name}・` : ''}等待中`}</span>
    : it.status === 'added' || it.status === 'updated'
      ? <span>{g?.name || label}<small>{note}</small></span>
      : it.status === 'duplicate'
        ? <span className="muted">{it.message ?? '重複'}，略過</span>
        : <span className="batch-err">無法處理：{it.message}</span>;
  const inner = <><div className="batch-thumb">{url && <img src={url} alt="" />}</div>{body}</>;
  return (
    <li className={`batch-row ${it.status}`}>
      {g && it.status !== 'pending' ? <a href={href(`/wardrobe/item/${g.id}/edit` as `/wardrobe/item/${string}`)}>{inner}</a> : <div>{inner}</div>}
    </li>
  );
}
