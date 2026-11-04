import { useEffect, useState } from 'react';
import { Badge, EmptyState, ListLink, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { modelsCached } from '../ai/assets';
import { listPersons } from '../lib/persons';
import { href } from '../lib/router';
import type { PersonPhoto } from '../lib/types';
import { useImageUrl } from '../lib/useImageUrl';

export function TryOn() {
  const [cached, setCached] = useState<boolean | null>(null);
  const [persons, setPersons] = useState<PersonPhoto[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void modelsCached().then(setCached);
    listPersons().then(setPersons, (e: Error) => setErr(e.message));
  }, []);
  return (
    <div className="page">
      <PageHeader title="AI 試穿" subtitle="電腦視覺 + 圖像合成"
        right={<a className="btn btn-small btn-primary" href={href('/tryon/person/new')}><Icon name="plus" size={18} /> 全身照</a>} />
      {err && <div className="alert alert-err">{err}</div>}

      <h3 className="section-title">選擇全身照開始試穿</h3>
      {persons && persons.length === 0 && (
        <EmptyState icon="user" mascot="her" title="先新增一張全身照" action={<a className="btn btn-primary" href={href('/tryon/person/new')}><Icon name="camera" size={18} /> 新增全身照</a>}>
          AI 會在手機上找出肩膀、手肘、腰、臀、膝蓋的位置與身體輪廓，之後就能把衣櫥的衣服穿上去。
        </EmptyState>
      )}
      {persons && persons.length > 0 && (
        <div className="grid">
          {persons.map((p) => <PersonCard key={p.id} p={p} />)}
        </div>
      )}

      <section className="card" style={{ marginTop: 16 }}>
        <div className="row-between">
          <h2>試穿功能</h2>
          {cached === null ? null : cached ? <Badge tone="ok">AI 已下載，可離線</Badge> : <Badge>首次使用時下載</Badge>}
        </div>
        <p className="muted">點選上方的全身照開始試穿。衣服會依身體關鍵點變形後合成，全程在手機上完成。</p>
        <ListLink to="/settings/diagnostics" icon="cpu" title="技術檢測" detail="測試 AI" />
      </section>
      <p className="disclaimer">說明：試穿結果是以 2D 影像變形與合成產生的預覽，不是生成式 AI，無法呈現真實布料垂墜與實際合身度。</p>
    </div>
  );
}

function PersonCard({ p }: { p: PersonPhoto }) {
  const url = useImageUrl(p.thumbImageId);
  const bad = p.analysis?.checks.some((c) => c.level === 'error');
  const warn = p.analysis?.checks.filter((c) => c.level === 'warn').length ?? 0;
  return (
    <a className="garment-card" href={bad || !p.analysis ? `#/tryon/person/${p.id}` : `#/tryon/studio/${p.id}`}>
      <div className="garment-img">{url && <img src={url} alt="" />}</div>
      <span className="garment-name">{p.name}</span>
      <span className="garment-meta">{!p.analysis ? '尚未辨識' : bad ? '⚠ 無法試穿，需校正' : warn ? `${warn} 項提醒` : '✓ 可以試穿'}</span>
    </a>
  );
}
