import { useEffect, useMemo, useState } from 'react';
import { EmptyState, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { listGarments, toggleFavorite } from '../lib/garments';
import { href } from '../lib/router';
import { CATEGORIES, SEASON_LABEL, type CategoryId, type Garment } from '../lib/types';
import { useImageUrl } from '../lib/useImageUrl';
import { Avatar, OwnerAvatar } from '../components/Mascot';
import { belongsTo, useCouple } from '../lib/couple';

type Filter = CategoryId | 'all' | 'fav';
const FILTER_KEY = 'wardrobe-filter';
const OWNER_KEY = 'wardrobe-owner';
type Who = 'all' | 'her' | 'him';

export function Wardrobe() {
  const [items, setItems] = useState<Garment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(() => { try { return (sessionStorage.getItem(FILTER_KEY) as Filter) || 'all'; } catch { return 'all'; } });
  const [q, setQ] = useState('');
  const [who, setWho] = useState<Who>(() => { try { return (sessionStorage.getItem(OWNER_KEY) as Who) || 'all'; } catch { return 'all'; } });
  const couple = useCouple();
  useEffect(() => { try { sessionStorage.setItem(OWNER_KEY, who); } catch { /* ignore */ } }, [who]);

  useEffect(() => { listGarments().then(setItems, (e: Error) => setErr(e.message)); }, []);
  useEffect(() => { try { sessionStorage.setItem(FILTER_KEY, filter); } catch { /* ignore */ } }, [filter]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of items ?? []) if (who === 'all' || belongsTo(g.owner, who)) m.set(g.category, (m.get(g.category) ?? 0) + 1);
    return m;
  }, [items, who]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (items ?? []).filter((g) =>
      (who === 'all' || belongsTo(g.owner, who)) &&
      (filter === 'all' || (filter === 'fav' ? g.favorite === 1 : g.category === filter)) &&
      (!kw || [g.name, g.brand, g.color, g.notes, g.size, CATEGORIES.find((c) => c.id === g.category)?.label ?? '', ...g.seasons.map((s) => SEASON_LABEL[s])].some((f) => f.toLowerCase().includes(kw))));
  }, [items, filter, q, who]);

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
      <div className="owner-tabs" role="tablist" aria-label="誰的衣服">
        <button role="tab" aria-selected={who === 'all'} className={`owner-tab who-both ${who === 'all' ? 'on' : ''}`} onClick={() => setWho('all')}><OwnerAvatar owner="both" size={24} /> 全部</button>
        <button role="tab" aria-selected={who === 'her'} className={`owner-tab who-her ${who === 'her' ? 'on' : ''}`} onClick={() => setWho('her')}><Avatar who="her" size={26} /> {couple.herName}</button>
        <button role="tab" aria-selected={who === 'him'} className={`owner-tab who-him ${who === 'him' ? 'on' : ''}`} onClick={() => setWho('him')}><Avatar who="him" size={26} /> {couple.himName}</button>
      </div>
      <label className="search" style={{ marginTop: 12 }}>
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
        <EmptyState icon="hanger" mascot="couple" title="衣櫥還是空的" action={<a className="btn btn-primary" href={href('/wardrobe/new')}><Icon name="camera" size={18} /> 新增第一件衣服</a>}>
          拍照或從相簿選擇，AI 會在手機上自動去背。
        </EmptyState>
      )}
      {items && items.length > 0 && shown.length === 0 && <EmptyState icon="search" mascot="him" title="找不到符合的衣服">試試其他關鍵字或分類。</EmptyState>}
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
      {g.owner && g.owner !== 'both' && <span className="garment-owner"><Avatar who={g.owner} size={28} /></span>}
      <button className={`fav-btn ${g.favorite ? 'on' : ''}`} aria-label={g.favorite ? '取消收藏' : '收藏'} onClick={onFav}><Icon name="heart" size={20} filled={!!g.favorite} /></button>
    </div>
  );
}
