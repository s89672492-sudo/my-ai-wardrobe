import { useEffect, useState } from 'react';
import { EmptyState, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { saveFile } from '../lib/backup';
import { getDB } from '../lib/db';
import { getImageBlob } from '../lib/garments';
import { href } from '../lib/router';
import { deleteTryOn, listTryOns } from '../lib/tryons';
import { deleteOutfit } from '../lib/outfits';
import { listHistory } from '../lib/history';
import { RecommendPanel } from '../components/RecommendPanel';
import type { HistoryEntry } from '../lib/types';
import { listGarments } from '../lib/garments';
import type { Garment } from '../lib/types';
import type { Outfit, TryOnResult } from '../lib/types';
import { useImageUrl } from '../lib/useImageUrl';

export function Outfits() {
  const [tab, setTab] = useState<'recommend' | 'saved' | 'history'>(() => (location.hash.includes('tab=') ? (location.hash.split('tab=')[1] as 'recommend') : 'recommend'));
  const [recHistory, setRecHistory] = useState<HistoryEntry[]>([]);
  const [outfits, setOutfits] = useState<Outfit[] | null>(null);
  const [tryons, setTryons] = useState<TryOnResult[] | null>(null);
  const [garments, setGarments] = useState<Map<string, Garment>>(new Map());
  const [open, setOpen] = useState<TryOnResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => getDB().then(async (db) => {
    setOutfits((await db.getAllFromIndex('outfits', 'byCreatedAt')).reverse());
    setTryons(await listTryOns());
    setGarments(new Map((await listGarments()).map((g) => [g.id, g])));
    setRecHistory(await listHistory('recommend', 20));
  }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);

  return (
    <div className="page">
      <PageHeader title="穿搭收藏" />
      <div className="segmented three" role="tablist">
        <button role="tab" aria-selected={tab === 'recommend'} className={tab === 'recommend' ? 'on' : ''} onClick={() => setTab('recommend')}>推薦穿搭</button>
        <button role="tab" aria-selected={tab === 'saved'} className={tab === 'saved' ? 'on' : ''} onClick={() => { setTab('saved'); void load(); }}>收藏穿搭{outfits?.length ? ` ${outfits.length}` : ''}</button>
        <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => { setTab('history'); void load(); }}>試穿紀錄{tryons?.length ? ` ${tryons.length}` : ''}</button>
      </div>
      {tab === 'recommend' && <div style={{ marginTop: 12 }}><RecommendPanel /></div>}
      {err && <div className="alert alert-err">{err}</div>}
      {tab === 'saved' && outfits?.length === 0 && <EmptyState icon="heart" title="還沒有收藏的穿搭" action={<a className="btn btn-primary" href={href('/tryon')}>去搭配</a>}>在 AI 試穿頁組合上衣、下身、外套後按「收藏穿搭」。</EmptyState>}
      {tab === 'saved' && (
        <div className="grid" style={{ marginTop: 14 }}>
          {outfits?.map((o) => <OutfitCard key={o.id} o={o} garments={garments} onDelete={async () => { if (confirm(`刪除穿搭「${o.name}」？（衣服本身不會被刪除）`)) { await deleteOutfit(o.id); void load(); } }} />)}
        </div>
      )}
      {tab === 'history' && tryons?.length === 0 && (
        <EmptyState icon="sparkle" title="還沒有試穿紀錄" action={<a className="btn btn-primary" href={href('/tryon')}>去試穿</a>}>在 AI 試穿頁按「儲存試穿」後會出現在這裡。</EmptyState>
      )}
      {tab === 'history' && (
        <div className="grid" style={{ marginTop: 14 }}>
          {tryons?.map((t) => <TryOnCard key={t.id} t={t} onOpen={() => setOpen(t)} />)}
        </div>
      )}
      {tab === 'history' && recHistory.length > 0 && (
        <>
          <h3 className="section-title">推薦紀錄（試穿或收藏過的推薦）</h3>
          <ul className="layers card">
            {recHistory.map((h) => {
              const items = h.refId.replace(/^rec:/, '').split('+').map((id) => garments.get(id));
              return (
                <li key={h.id}>
                  <MiniThumb id={items[0]?.thumbImageId} />
                  <span className="layer-text"><small>{new Date(h.createdAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>{items.map((g) => g?.name ?? '（已刪除）').join(' + ')}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {open && <Viewer t={open} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); void load(); }} />}
    </div>
  );
}

function OutfitCard({ o, garments, onDelete }: { o: Outfit; garments: Map<string, Garment>; onDelete: () => void }) {
  const url = useImageUrl(o.previewImageId);
  const items = o.garmentIds.map((id) => garments.get(id));
  const missing = items.filter((g) => !g).length;
  const to = o.personId ? `#/tryon/studio/${o.personId}/o/${o.id}` : '#/tryon';
  return (
    <div className="garment-card">
      <a href={to}>
        <div className="garment-img">{url ? <img src={url} alt="" /> : <MiniStack ids={items.map((g) => g?.thumbImageId)} />}</div>
        <span className="garment-name">{o.name}</span>
        <span className="garment-meta">{items.filter(Boolean).map((g) => g!.name).join('、')}{missing ? `（${missing} 件已刪除）` : ''}</span>
      </a>
      <button className="fav-btn" aria-label="刪除穿搭" onClick={onDelete}><Icon name="trash" size={18} /></button>
    </div>
  );
}

function MiniStack({ ids }: { ids: (string | undefined)[] }) {
  return <div className="mini-stack">{ids.slice(0, 4).map((id, i) => <MiniThumb key={i} id={id} />)}</div>;
}
function MiniThumb({ id }: { id?: string }) {
  const url = useImageUrl(id);
  return url ? <img src={url} alt="" /> : <span />;
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
    if (b) await saveFile(new File([b], `ai-tryon-${t.createdAt}.jpg`, { type: 'image/jpeg' }));
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
