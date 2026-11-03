import { useEffect, useMemo, useState } from 'react';
import { EmptyState, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { getDB } from '../lib/db';
import { CATEGORIES, type CategoryId, type Garment } from '../lib/types';

export function Wardrobe() {
  const [items, setItems] = useState<Garment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState<CategoryId | 'all'>('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    getDB().then((db) => db.getAllFromIndex('garments', 'byCreatedAt')).then((all) => setItems(all.reverse()), (e: Error) => setErr(e.message));
  }, []);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (items ?? []).filter((g) => (cat === 'all' || g.category === cat) && (!kw || [g.name, g.brand, g.color, g.notes].some((f) => f.toLowerCase().includes(kw))));
  }, [items, cat, q]);

  return (
    <div className="page">
      <PageHeader title="我的衣櫥" subtitle={items ? `共 ${items.length} 件` : undefined} />
      <label className="search">
        <Icon name="search" size={20} />
        <input type="search" placeholder="搜尋名稱、品牌、顏色" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
      </label>
      <div className="chips" role="tablist" aria-label="分類">
        <button role="tab" aria-selected={cat === 'all'} className={cat === 'all' ? 'chip on' : 'chip'} onClick={() => setCat('all')}>全部</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'chip on' : 'chip'} onClick={() => setCat(c.id)}>{c.label}</button>
        ))}
      </div>

      {err && <div className="alert alert-err">{err}</div>}
      {items && items.length === 0 && (
        <EmptyState icon="hanger" title="衣櫥還是空的">
          下一階段（Phase 2）將開放用相機拍照或從相簿選擇，自動去背後存進衣櫥。
        </EmptyState>
      )}
      {items && items.length > 0 && shown.length === 0 && <EmptyState icon="search" title="找不到符合的衣服" />}
      <div className="grid">
        {shown.map((g) => (
          <div key={g.id} className="garment-card"><div className="garment-img" /><span>{g.name}</span></div>
        ))}
      </div>
    </div>
  );
}
