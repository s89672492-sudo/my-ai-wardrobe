import { useEffect, useState } from 'react';
import { EmptyState, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { saveFile } from '../lib/backup';
import { getDB } from '../lib/db';
import { getImageBlob } from '../lib/garments';
import { href } from '../lib/router';
import { deleteTryOn, listTryOns } from '../lib/tryons';
import type { Outfit, TryOnResult } from '../lib/types';
import { useImageUrl } from '../lib/useImageUrl';

export function Outfits() {
  const [tab, setTab] = useState<'saved' | 'history'>('history');
  const [outfits, setOutfits] = useState<Outfit[] | null>(null);
  const [tryons, setTryons] = useState<TryOnResult[] | null>(null);
  const [open, setOpen] = useState<TryOnResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => getDB().then(async (db) => {
    setOutfits((await db.getAllFromIndex('outfits', 'byCreatedAt')).reverse());
    setTryons(await listTryOns());
  }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);

  return (
    <div className="page">
      <PageHeader title="穿搭收藏" />
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'saved'} className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>收藏穿搭</button>
        <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>試穿紀錄{tryons?.length ? ` ${tryons.length}` : ''}</button>
      </div>
      {err && <div className="alert alert-err">{err}</div>}
      {tab === 'saved' && outfits?.length === 0 && <EmptyState icon="heart" title="還沒有收藏的穿搭">多件組合與 AI 穿搭推薦將於 Phase 5、6 開放。</EmptyState>}
      {tab === 'history' && tryons?.length === 0 && (
        <EmptyState icon="sparkle" title="還沒有試穿紀錄" action={<a className="btn btn-primary" href={href('/tryon')}>去試穿</a>}>在 AI 試穿頁按「儲存試穿」後會出現在這裡。</EmptyState>
      )}
      {tab === 'history' && (
        <div className="grid" style={{ marginTop: 14 }}>
          {tryons?.map((t) => <TryOnCard key={t.id} t={t} onOpen={() => setOpen(t)} />)}
        </div>
      )}
      {open && <Viewer t={open} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); void load(); }} />}
    </div>
  );
}

function TryOnCard({ t, onOpen }: { t: TryOnResult; onOpen: () => void }) {
  const url = useImageUrl(t.thumbImageId);
  return (
    <button className="garment-card plain" onClick={onOpen}>
      <div className="garment-img">{url && <img src={url} alt="" />}</div>
      <span className="garment-meta">{new Date(t.createdAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
    </button>
  );
}

function Viewer({ t, onClose, onDeleted }: { t: TryOnResult; onClose: () => void; onDeleted: () => void }) {
  const url = useImageUrl(t.imageId);
  async function share() {
    const b = await getImageBlob(t.imageId);
    if (b) await saveFile(new File([b], `AI試穿-${t.createdAt}.jpg`, { type: 'image/jpeg' }));
  }
  async function del() {
    if (!confirm('確定刪除這張試穿圖？')) return;
    await deleteTryOn(t.id);
    onDeleted();
  }
  return (
    <div className="viewer" role="dialog" aria-modal="true">
      <button className="icon-btn viewer-close" aria-label="關閉" onClick={onClose}><Icon name="close" /></button>
      {url && <img src={url} alt="試穿結果" />}
      <div className="viewer-actions">
        <a className="btn" href={`#/tryon/studio/${t.personId}/${t.garmentIds[0] ?? ''}`}>再試一次</a>
        <button className="btn" onClick={() => void share()}><Icon name="share" size={18} /> 分享</button>
        <button className="btn btn-danger" onClick={() => void del()}><Icon name="trash" size={18} /></button>
      </div>
    </div>
  );
}
