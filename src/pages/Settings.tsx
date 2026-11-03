import { useEffect, useState } from 'react';
import { Badge, ListLink, PageHeader } from '../components/ui';
import { Icon } from '../components/Icon';
import { AIClient } from '../ai/client';
import { MODEL_URLS, WASM_PATH, modelsCached } from '../ai/assets';
import { clearAllData } from '../lib/db';
import { formatMB, getStorageInfo, isStandalone, requestPersist, useOnline, type StorageInfo } from '../lib/platform';
import { useSettings } from '../lib/settings';
import type { ComputeMode } from '../lib/types';

const MODES: { id: ComputeMode; title: string; desc: string }[] = [
  { id: 'auto', title: '自動', desc: '依手機效能自動選擇（建議）' },
  { id: 'high', title: '高品質', desc: '照片上限 1536px，較耗電與記憶體' },
  { id: 'balanced', title: '平衡', desc: '照片上限 1024px，適合大多數手機' },
  { id: 'saver', title: '省電', desc: '照片上限 640px，適合舊手機或低電量' },
];

export function Settings() {
  const { settings, update, error } = useSettings();
  const online = useOnline();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const [dl, setDl] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  const refresh = () => { void getStorageInfo().then(setStorage); void modelsCached().then(setCached); };
  useEffect(refresh, []);

  async function downloadModels() {
    const c = new AIClient();
    setDl('準備中');
    try {
      const r = await c.init(WASM_PATH, 'wasm', MODEL_URLS, setDl);
      if (r.type === 'ready' && r.models.every((m) => m.ok)) setMsg({ text: 'AI 模型已下載，之後可離線使用。', tone: 'ok' });
      else setMsg({ text: 'AI 模型下載不完整，請確認網路後再試一次。', tone: 'err' });
    } catch (e) {
      setMsg({ text: `下載失敗：${(e as Error).message}`, tone: 'err' });
    } finally {
      await c.terminate();
      setDl(null);
      refresh();
    }
  }

  async function persist() {
    const ok = await requestPersist();
    setMsg(ok ? { text: '已取得永久儲存權限，瀏覽器不會自動清除資料。', tone: 'ok' } : { text: '瀏覽器未同意。iPhone 請先「加入主畫面」，並從主畫面開啟 App 使用。', tone: 'err' });
    refresh();
  }

  async function wipe() {
    if (!confirm('確定要刪除所有衣服、照片、試穿結果與設定嗎？此動作無法復原。')) return;
    if (!confirm('再確認一次：所有資料將永久刪除。建議先匯出備份。')) return;
    try {
      await clearAllData();
      if ('caches' in self) for (const k of await caches.keys()) if (k.startsWith('ai-')) await caches.delete(k);
      location.reload();
    } catch (e) {
      setMsg({ text: `清除失敗：${(e as Error).message}`, tone: 'err' });
    }
  }

  return (
    <div className="page">
      <PageHeader title="個人設定" />
      {error && <div className="alert alert-err">{error}</div>}
      {msg && <div className={`alert alert-${msg.tone}`} role="status" onClick={() => setMsg(null)}>{msg.text}</div>}

      <h3 className="section-title">運算模式</h3>
      <div className="card options" role="radiogroup" aria-label="運算模式">
        {MODES.map((m) => (
          <label key={m.id} className="option">
            <input type="radio" name="mode" checked={settings.computeMode === m.id} onChange={() => void update({ computeMode: m.id })} />
            <span><b>{m.title}</b><small>{m.desc}</small></span>
          </label>
        ))}
      </div>
      <div className="card">
        <label className="option toggle">
          <span><b>只使用 CPU 運算</b><small>關閉 WebGPU。iPhone 目前一律使用 CPU；Android 若發熱或出錯可開啟。</small></span>
          <input type="checkbox" role="switch" checked={settings.backend === 'wasm'} onChange={(e) => void update({ backend: e.target.checked ? 'wasm' : 'auto' })} />
        </label>
      </div>

      <h3 className="section-title">AI 模型</h3>
      <div className="card">
        <div className="row-between">
          <span>離線使用</span>
          {cached === null ? null : cached ? <Badge tone="ok">已下載</Badge> : <Badge tone="warn">尚未下載</Badge>}
        </div>
        <p className="muted">模型約 5 MB、執行環境約 3 MB，下載一次後在手機上執行。瀏覽器仍可能在空間不足時清除快取，屆時會自動重新下載。</p>
        <button className="btn" disabled={!!dl || !online} onClick={() => void downloadModels()}>
          {dl ? `⏳ ${dl}` : !online ? '目前離線，無法下載' : cached ? '重新下載 AI 模型' : '下載 AI 模型'}
        </button>
        <ListLink to="/settings/diagnostics" icon="cpu" title="技術檢測" detail="WebGPU、速度、記憶體" />
      </div>

      <h3 className="section-title">儲存空間</h3>
      <div className="card">
        {storage ? (
          <>
            <div className="meter" aria-label="儲存空間使用量"><div style={{ width: `${Math.min(100, (storage.usageMB / Math.max(1, storage.quotaMB)) * 100)}%` }} /></div>
            <p className="muted">已使用 {formatMB(storage.usageMB)}，可用上限約 {formatMB(storage.quotaMB)}</p>
            <div className="row-between">
              <span>永久儲存</span>
              {storage.persisted ? <Badge tone="ok">已授權</Badge> : <button className="btn btn-small" onClick={() => void persist()}>申請</button>}
            </div>
          </>
        ) : <p className="muted">此瀏覽器不提供儲存空間資訊。</p>}
        {!isStandalone() && <p className="muted">提醒：請勿使用「私密瀏覽」，關閉分頁後資料會被清除。</p>}
      </div>

      <h3 className="section-title">資料管理</h3>
      <div className="card">
        <p className="muted">完整匯出與匯入備份將於 Phase 2（衣服）與 Phase 7（全部資料）開放。</p>
        <button className="btn btn-danger" onClick={() => void wipe()}><Icon name="trash" size={18} /> 清除所有資料</button>
      </div>

      <h3 className="section-title">關於</h3>
      <div className="card about">
        <p><Icon name="shield" size={16} /> 照片與資料只存在這支手機的瀏覽器資料庫，不上傳任何伺服器，不使用雲端 AI。</p>
        <p className="muted">版本 {__APP_VERSION__} · 開放原始碼授權見 GitHub 上的 THIRD_PARTY_NOTICES.md</p>
      </div>
    </div>
  );
}
