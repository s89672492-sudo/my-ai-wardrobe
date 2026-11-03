import { useEffect, useState } from 'react';
import { Badge, ListLink, PageHeader } from '../components/ui';
import { modelsCached } from '../ai/assets';

const STEPS = [
  ['選擇全身照片', '從相簿選擇或用相機拍攝，照片只在手機處理'],
  ['AI 偵測人體', '找出肩膀、手肘、手腕、腰、臀、膝蓋位置與身體輪廓'],
  ['選擇衣櫥中的衣服', '可組合上衣、下身、外套、洋裝'],
  ['變形與合成', '依身體關鍵點以 TPS 變形衣服，處理手臂遮擋後合成'],
  ['微調與保存', '手動調整位置、大小、角度，並比較試穿前後'],
];

export function TryOn() {
  const [cached, setCached] = useState<boolean | null>(null);
  useEffect(() => { void modelsCached().then(setCached); }, []);
  return (
    <div className="page">
      <PageHeader title="AI 試穿" subtitle="電腦視覺 + 圖像合成" />
      <section className="card">
        <div className="row-between">
          <h2>AI 引擎</h2>
          {cached === null ? null : cached ? <Badge tone="ok">已下載，可離線</Badge> : <Badge>首次使用時下載約 8 MB</Badge>}
        </div>
        <p className="muted">試穿功能將於 Phase 4 開放。目前可先在技術檢測頁確認手機能否執行 AI 人體辨識。</p>
        <ListLink to="/settings/diagnostics" icon="cpu" title="技術檢測" detail="測試 AI" />
      </section>
      <section className="card">
        <h2>試穿流程</h2>
        <ol className="timeline">
          {STEPS.map(([t, d], i) => <li key={t}><span className="step-no">{i + 1}</span><div><b>{t}</b><p>{d}</p></div></li>)}
        </ol>
      </section>
      <p className="disclaimer">說明：試穿結果是以 2D 影像變形與合成產生的預覽，不是生成式 AI，無法呈現真實布料垂墜與實際合身度。</p>
    </div>
  );
}
