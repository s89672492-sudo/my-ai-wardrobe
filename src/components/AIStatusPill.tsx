import { useEffect, useState, useSyncExternalStore } from 'react';
import { aiStatus } from '../ai/client';

/** 畫面上方的 AI 執行狀態提示（下載模型、運算中）；短於 0.4 秒的工作不顯示，避免閃爍 */
export function AIStatusPill() {
  const s = useSyncExternalStore(aiStatus.subscribe, aiStatus.get);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!s.active) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), Math.max(0, 400 - (Date.now() - s.since)));
    return () => clearTimeout(t);
  }, [s.active, s.since]);
  if (!show || !s.active) return null;
  return <div className="ai-pill" role="status" aria-live="polite"><span className="spinner" /> {s.stage ?? 'AI 運算中'}<small>本機</small></div>;
}
