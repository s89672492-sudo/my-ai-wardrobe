import { useEffect, useState } from 'react';
import { EmptyState, PageHeader } from '../components/ui';
import { getDB } from '../lib/db';
import type { HistoryEntry, Outfit } from '../lib/types';

export function Outfits() {
  const [tab, setTab] = useState<'saved' | 'history'>('saved');
  const [outfits, setOutfits] = useState<Outfit[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getDB().then(async (db) => {
      setOutfits((await db.getAllFromIndex('outfits', 'byCreatedAt')).reverse());
      setHistory((await db.getAllFromIndex('history', 'byCreatedAt')).reverse());
    }, (e: Error) => setErr(e.message));
  }, []);
  const list = tab === 'saved' ? outfits : history;
  return (
    <div className="page">
      <PageHeader title="穿搭收藏" />
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'saved'} className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>收藏穿搭</button>
        <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>歷史紀錄</button>
      </div>
      {err && <div className="alert alert-err">{err}</div>}
      {list && list.length === 0 && (tab === 'saved'
        ? <EmptyState icon="heart" title="還沒有收藏的穿搭">試穿或 AI 推薦後，喜歡的組合可以收藏在這裡（Phase 5、6 開放）。</EmptyState>
        : <EmptyState icon="info" title="還沒有紀錄">每次試穿與推薦都會留下紀錄，方便回顧。</EmptyState>)}
    </div>
  );
}
