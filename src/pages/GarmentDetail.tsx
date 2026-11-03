import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { EmptyState, PageHeader } from '../components/ui';
import { deleteGarment, getGarment, toggleFavorite } from '../lib/garments';
import { navigate } from '../lib/router';
import { listPersons } from '../lib/persons';
import { KIND_OF } from '../tryon/garmentAnchors';
import { CATEGORIES, SEASON_LABEL, type Garment } from '../lib/types';
import { useImageUrl } from '../lib/useImageUrl';

export function GarmentDetail({ id }: { id: string }) {
  const [g, setG] = useState<Garment | null | undefined>(undefined);
  const [showOriginal, setShowOriginal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getGarment(id).then((x) => setG(x ?? null), (e: Error) => setErr(e.message)); }, [id]);
  const cutUrl = useImageUrl(g?.cutoutImageId);
  const origUrl = useImageUrl(showOriginal || !g?.cutoutImageId ? g?.originalImageId : null);

  if (g === null) return <div className="page"><PageHeader title="衣服" back="/wardrobe" /><EmptyState icon="hanger" title="找不到這件衣服">可能已被刪除。</EmptyState></div>;
  if (!g) return <div className="page">{err && <div className="alert alert-err">{err}</div>}</div>;

  const cat = CATEGORIES.find((c) => c.id === g.category)?.label;
  const url = showOriginal || !g.cutoutImageId ? origUrl : cutUrl;
  async function fav() { try { const f = await toggleFavorite(g!.id); setG({ ...g!, favorite: f }); } catch (e) { setErr((e as Error).message); } }
  async function tryOn() {
    const ps = (await listPersons()).filter((p) => p.analysis && !p.analysis.checks.some((c) => c.level === 'error'));
    if (!ps.length) { if (confirm('還沒有可用的全身照，要先新增一張嗎？')) navigate('/tryon/person/new'); return; }
    navigate(`/tryon/studio/${ps[0]!.id}/${g!.id}`);
  }
  async function del() {
    if (!confirm(`確定要刪除「${g!.name}」嗎？照片也會一併刪除，無法復原。`)) return;
    try { await deleteGarment(g!.id); navigate('/wardrobe', true); } catch (e) { setErr(`刪除失敗：${(e as Error).message}`); }
  }

  return (
    <div className="page">
      <PageHeader title={g.name || cat || '衣服'} back="/wardrobe"
        right={<button className={`icon-btn fav ${g.favorite ? 'on' : ''}`} aria-label={g.favorite ? '取消收藏' : '收藏'} onClick={() => void fav()}><Icon name="heart" filled={!!g.favorite} /></button>} />
      {err && <div className="alert alert-err">{err}</div>}
      <div className={`detail-hero ${showOriginal || !g.cutoutImageId ? '' : 'checker-soft'}`}>{url && <img src={url} alt={g.name} />}</div>
      {g.cutoutImageId && (
        <div className="segmented small">
          <button className={!showOriginal ? 'on' : ''} onClick={() => setShowOriginal(false)}>去背</button>
          <button className={showOriginal ? 'on' : ''} onClick={() => setShowOriginal(true)}>原圖</button>
        </div>
      )}
      <dl className="specs">
        <dt>分類</dt><dd>{cat}</dd>
        <dt>顏色</dt><dd>{g.color || '—'}</dd>
        <dt>品牌</dt><dd>{g.brand || '—'}</dd>
        <dt>尺寸</dt><dd>{g.size || '—'}</dd>
        <dt>季節</dt><dd>{g.seasons.length ? g.seasons.map((s) => SEASON_LABEL[s]).join('、') : '—'}</dd>
        {g.styles?.length ? <><dt>風格</dt><dd>{g.styles.map((s) => ({ casual: '休閒', formal: '正式', sport: '運動' })[s]).join('、')}</dd></> : null}
        {g.notes && <><dt>備註</dt><dd className="pre">{g.notes}</dd></>}
        <dt>新增於</dt><dd>{new Date(g.createdAt).toLocaleDateString('zh-TW')}</dd>
      </dl>
      {KIND_OF[g.category] && (
        <button className="btn btn-primary" onClick={() => void tryOn()}><Icon name="sparkle" size={18} /> 試穿這件</button>
      )}
      <div className="row-2">
        <a className="btn" href={`#/wardrobe/item/${g.id}/edit`}><Icon name="edit" size={18} /> 編輯</a>
        <button className="btn btn-danger" onClick={() => void del()}><Icon name="trash" size={18} /> 刪除</button>
      </div>
    </div>
  );
}
