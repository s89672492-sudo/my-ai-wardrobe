import { useEffect, useMemo, useState } from 'react';
import { EmptyState, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { listGarments, toggleFavorite } from '../lib/garments';
import { href } from '../lib/router';
import { CATEGORIES, SEASON_LABEL, type CategoryId, type Garment } from '../lib/types';
import { useImageUrl } from '../lib/useImageUrl';

type Filter = CategoryId | 'all' | 'fav';
const FILTER_KEY = 'wardrobe-filter';

export function Wardrobe() {
  const [items, setItems] = useState<Garment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(() => { try { return (sessionStorage.getItem(FILTER_KEY) as Filter) || 'all'; } catch { return 'all'; } });
  const [q, setQ] = useState('');

  useEffect(() => { listGarments().then(setItems, (e: Error) => setErr(e.message)); }, []);
  useEffect(() => { try { sessionStorage.setItem(FILTER_KEY, filter); } catch { /* ignore */ } }, [filter]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of items ?? []) m.set(g.category, (m.get(g.category) ?? 0) + 1);
    return m;
  }, [items]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (items ?? []).filter((g) =>
      (filter === 'all' || (filter === 'fav' ? g.favorite === 1 : g.category === filter)) &&
      (!kw || [g.name, g.brand, g.color, g.notes, g.size, CATEGORIES.find((c) => c.id === g.category)?.label ?? '', ...g.seasons.map((s) => SEASON_LABEL[s])].some((f) => f.toLowerCase().includes(kw))));
  }, [items, filter, q]);

  async function fav(id: string) {
    try {
      const f = await toggleFavorite(id);
      setItems((all) => all?.map((g) => (g.id === id ? { ...g, favorite: f } : g)) ?? null);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="page">
      <PageHeader title="我的衣櫥" subtitle={items ? `共 ${items.length} 件` : undefined}
        right={<a className="btn btn-small btn-primary" href={href('/wardrobe/new')}><Icon name="plus" size={18} /> 新增</a>} />
      <label className="search">
        <Icon name="search" size={20} />
        <input type="search" placeholder="搜尋名稱、品牌、顏色、尺寸" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
      </label>
      <div className="chips" role="tablist" aria-label="分類">
        <button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'chip on' : 'chip'} onClick={() => setFilter('all')}>全部</button>
        <button role="tab" aria-selected={filter === 'fav'} className={filter === 'fav' ? 'chip on' : 'chip'} onClick={() => setFilter('fav')}>♥ 收藏</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={filter === c.id} className={filter === c.id ? 'chip on' : 'chip'} onClick={() => setFilter(c.id)}>
            {c.label}{counts.get(c.id) ? <small> {counts.get(c.id)}</small> : null}
          </button>
        ))}
      </div>

      {err && <div className="alert alert-err">{err}</div>}
      {items && items.length === 0 && (
        <EmptyState icon="hanger" title="衣櫥還是空的" action={<a className="btn btn-primary" href={href('/wardrobe/new')}><Icon name="camera" size={18} /> 新增第一件衣服</a>}>
          拍照或從相簿選擇，AI 會在手機上自動去背。
        </EmptyState>
      )}
      {items && items.length > 0 && shown.length === 0 && <EmptyState icon="search" title="找不到符合的衣服">試試其他關鍵字或分類。</EmptyState>}
      <div className="grid">
        {shown.map((g) => <GarmentCard key={g.id} g={g} onFav={() => void fav(g.id)} />)}
      </div>
    </div>
  );
}

function GarmentCard({ g, onFav }: { g: Garment; onFav: () => void }) {
  const url = useImageUrl(g.thumbImageId);
  return (
    <div className="garment-card">
      <a href={`#/wardrobe/item/${g.id}`}>
        <div className="garment-img">{url && <img src={url} alt="" loading="lazy" />}</div>
        <span className="garment-name">{g.name}</span>
        <span className="garment-meta">{CATEGORIES.find((c) => c.id === g.category)?.label}{g.brand && ` · ${g.brand}`}</span>
      </a>
      <button className={`fav-btn ${g.favorite ? 'on' : ''}`} aria-label={g.favorite ? '取消收藏' : '收藏'} onClick={onFav}><Icon name="heart" size={20} filled={!!g.favorite} /></button>
    </div>
  );
}
