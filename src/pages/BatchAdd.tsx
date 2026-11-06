import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { OwnerAvatar } from '../components/Mascot';
import { cancelCutout, releaseCutoutModel } from '../ai/cutout';
import { releaseClassifier } from '../ai/garment-classify';
import { addGarmentFromFile, type BatchResult } from '../lib/batch';
import { acceleratorFor } from '../lib/compute';
import { useCouple } from '../lib/couple';
import { href } from '../lib/router';
import { useSettings } from '../lib/settings';
import { CATEGORIES, type Owner } from '../lib/types';
import { useImageUrl } from '../lib/useImageUrl';

interface Item { key: string; file: File; stage: string; result?: BatchResult }
const MAX_FILES = 30;

/** 一次新增多件衣服：選多張照片，手機依序自動去背、判斷顏色與種類後加入衣櫥 */
export function BatchAdd() {
  const { settings } = useSettings();
  const couple = useCouple();
  const [owner, setOwner] = useState<Owner>('both');
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const stop = useRef(false);

  useEffect(() => () => { stop.current = true; cancelCutout(); void releaseCutoutModel(); void releaseClassifier(); }, []);

  async function start(files: File[]) {
    if (!files.length) return;
    const list = files.slice(0, MAX_FILES).map((file, i) => ({ key: `${Date.now()}-${i}`, file, stage: '等待中' }));
    setNote(files.length > MAX_FILES ? `一次最多 ${MAX_FILES} 張，已先處理前 ${MAX_FILES} 張` : null);
    setItems(list);
    setRunning(true);
    stop.current = false;
    // 處理期間保持螢幕不關（支援的瀏覽器才有）
    let lock: { release: () => Promise<void> } | null = null;
    try { lock = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* 不支援 */ }
    for (const it of list) {
      if (stop.current) break;
      const set = (patch: Partial<Item>) => setItems((all) => all.map((x) => (x.key === it.key ? { ...x, ...patch } : x)));
      const result = await addGarmentFromFile(it.file, owner, acceleratorFor(settings), (stage) => set({ stage }));
      set({ result, stage: '' });
    }
    try { await lock?.release(); } catch { /* ignore */ }
    setRunning(false);
    void releaseCutoutModel();
  }

  function cancel() { stop.current = true; cancelCutout(); }

  const done = items.filter((i) => i.result).length;
  const added = items.filter((i) => i.result?.status === 'added').length;

  return (
    <div className="page">
      <PageHeader title="一次新增多件" subtitle={items.length ? `${done} / ${items.length} 張已處理` : '從相簿選多張衣服照片'} back="/wardrobe/new" />

      {!items.length && (
        <>
          <div className="field">
            <span>這些衣服是誰的</span>
            <div className="owner-tabs" role="radiogroup" aria-label="這些衣服是誰的" style={{ marginTop: 0 }}>
              {(['her', 'him', 'both'] as const).map((o) => (
                <button type="button" role="radio" aria-checked={owner === o} key={o} className={`owner-tab who-${o} ${owner === o ? 'on' : ''}`} onClick={() => setOwner(o)}>
                  <OwnerAvatar owner={o} size={24} /> {couple.nameOf(o)}
                </button>
              ))}
            </div>
          </div>
          <label className="pick-btn">
            <Icon name="image" size={34} /><b>選擇多張照片</b><span>一次最多 {MAX_FILES} 張</span>
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { void start(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          </label>
          <ul className="tips">
            <li>每張照片只拍一件衣服，衣服放在畫面中間</li>
            <li>手機會自動去背、判斷顏色和種類，之後可以在衣服頁修改</li>
            <li>處理時請停留在這個畫面；照片只在這支手機處理</li>
          </ul>
        </>
      )}

      {note && <div className="alert alert-warn">{note}</div>}
      {items.length > 0 && (
        <>
          {running && <div className="meter" aria-label="處理進度"><div style={{ width: `${(done / items.length) * 100}%` }} /></div>}
          <ul className="batch-list card">
            {items.map((it) => <BatchRow key={it.key} it={it} />)}
          </ul>
          {running
            ? <button className="btn" onClick={cancel}>停止（已完成的會保留）</button>
            : (
              <>
                <p className="muted center">已加入 {added} 件衣服。AI 判斷的種類可能有誤，點衣服可以修改。</p>
                <a className="btn btn-primary" href={href('/wardrobe')}>回到衣櫥</a>
                <button className="link-btn" onClick={() => setItems([])}>再選一批</button>
              </>
            )}
        </>
      )}
    </div>
  );
}

function BatchRow({ it }: { it: Item }) {
  const r = it.result;
  const url = useImageUrl(r?.status === 'added' ? r.garment.thumbImageId : r?.status === 'duplicate' ? r.existing.thumbImageId : null);
  const label = r?.status === 'added' ? CATEGORIES.find((c) => c.id === r.garment.category)?.label : '';
  const body = !r
    ? <span className="muted">{it.stage === '等待中' ? '等待中' : <><span className="spinner" /> {it.stage}</>}</span>
    : r.status === 'added'
      ? <span>{r.garment.name || label}<small>{r.aiCategory ? `AI 判斷：${label}` : '分類請自行確認'}{r.cutout ? '' : '・未去背'}</small></span>
      : r.status === 'duplicate'
        ? <span className="muted">已經在衣櫥裡（{r.existing.name}），略過</span>
        : <span className="batch-err">無法處理：{r.message}</span>;
  const inner = <><div className="batch-thumb">{url && <img src={url} alt="" />}</div>{body}</>;
  return (
    <li className={`batch-row ${r?.status ?? 'pending'}`}>
      {r?.status === 'added' ? <a href={href(`/wardrobe/item/${r.garment.id}/edit` as `/wardrobe/item/${string}`)}>{inner}</a> : <div>{inner}</div>}
    </li>
  );
}
