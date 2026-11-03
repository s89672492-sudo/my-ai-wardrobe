import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Badge, PageHeader } from '../components/ui';
import { exportBackup, importBackup, saveFile } from '../lib/backup';
import { clearAllData } from '../lib/db';
import { IMAGE_PROFILES } from '../lib/image';
import { getStorageInfo, isIOS, isStandalone, requestPersist, type StorageInfo } from '../lib/platform';
import { useSettings } from '../lib/settings';
import { clearRecommendHistory, clearTryOns, deleteImages, fmtBytes, KIND_ZH, optimizeImages, scanDuplicates, storageReport, type DuplicateReport, type StorageReport } from '../lib/storage';
import { deleteOutfit } from '../lib/outfits';
import type { ImageKind } from '../lib/types';

type Msg = { text: string; tone: 'ok' | 'err' } | null;

export function DataPage() {
  const { settings, update } = useSettings();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [report, setReport] = useState<StorageReport | null>(null);
  const [dupes, setDupes] = useState<DuplicateReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');

  const refresh = () => { void getStorageInfo().then(setInfo); void storageReport().then(setReport); };
  useEffect(refresh, []);

  async function run<T>(label: string, f: () => Promise<T>): Promise<T | undefined> {
    setBusy(label); setMsg(null);
    try { return await f(); } catch (e) { setMsg({ text: `${label}失敗：${(e as Error).message}`, tone: 'err' }); return undefined; } finally { setBusy(null); refresh(); }
  }

  const usagePct = info && info.quotaMB ? (info.usageMB / info.quotaMB) * 100 : 0;
  const likelyPrivate = !!info && info.quotaMB > 0 && info.quotaMB <= 1100 && !isStandalone();
  const days = settings.lastBackupAt ? Math.floor((Date.now() - settings.lastBackupAt) / 86400000) : null;
  const hasData = !!report && report.records.garments + report.records.persons > 0;

  return (
    <div className="page">
      <PageHeader title="資料與隱私" back="/settings" />
      {msg && <div className={`alert alert-${msg.tone}`} role="status" onClick={() => setMsg(null)}>{msg.text}</div>}

      <section className="card privacy-card">
        <h2><Icon name="shield" size={20} /> 隱私保護</h2>
        <ul>
          <li>衣服照片、全身照、去背圖、試穿圖、穿搭與設定，全部存在<b>這支手機的瀏覽器資料庫（IndexedDB）</b>。</li>
          <li>AI 去背、人體辨識、試穿合成、穿搭推薦都在手機上運算，<b>不上傳任何照片</b>，不使用雲端 AI。</li>
          <li>App 已設定瀏覽器安全政策（CSP），<b>只允許連線到本網站</b>（下載 App 與 AI 模型），技術上無法把資料傳到其他伺服器。</li>
          <li>沒有帳號、沒有雲端資料庫、沒有廣告或分析追蹤。</li>
        </ul>
      </section>

      <h3 className="section-title">儲存空間</h3>
      <div className="card">
        {info ? (
          <>
            <div className={`meter ${usagePct > 80 ? 'warn' : ''}`}><div style={{ width: `${Math.min(100, usagePct)}%` }} /></div>
            <p className="muted">本 App 已使用 {fmtBytes(info.usageMB * 1048576)}，瀏覽器允許上限約 {fmtBytes(info.quotaMB * 1048576)}（含 AI 模型快取）</p>
            {usagePct > 80 && <div className="alert alert-err">儲存空間快滿了，請匯出備份後刪除不需要的試穿紀錄或衣服，或使用「壓縮現有圖片」。</div>}
            {likelyPrivate && <div className="alert alert-warn">可用空間很小，可能正在使用「私密瀏覽」。私密瀏覽關閉分頁後所有資料會被清除，請改用一般模式並加入主畫面。</div>}
            <div className="row-between">
              <span>永久儲存（避免瀏覽器自動清除）</span>
              {info.persisted ? <Badge tone="ok">已授權</Badge> : <button className="btn btn-small" onClick={() => void requestPersist().then((ok) => { setMsg(ok ? { text: '已取得永久儲存權限', tone: 'ok' } : { text: isIOS ? 'Safari 未同意。請先「加入主畫面」，並從主畫面開啟 App 後再試一次。' : '瀏覽器未同意，請定期匯出備份。', tone: 'err' }); refresh(); })}>申請</button>}
            </div>
          </>
        ) : <p className="muted">此瀏覽器不提供儲存空間資訊。</p>}
        {report && (
          <table className="usage">
            <tbody>
              {(Object.entries(report.byKind) as [ImageKind, { count: number; bytes: number }][]).filter(([, v]) => v.count).sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => (
                <tr key={k}><td>{KIND_ZH[k]}</td><td>{v.count} 張</td><td>{fmtBytes(v.bytes)}</td></tr>
              ))}
              <tr className="total"><td>圖片合計</td><td /><td>{fmtBytes(report.totalBytes)}</td></tr>
            </tbody>
          </table>
        )}
        {report && <p className="muted">衣服 {report.records.garments} 件 · 全身照 {report.records.persons} 張 · 試穿 {report.records.tryons} 次 · 收藏穿搭 {report.records.outfits} 組</p>}
      </div>

      <h3 className="section-title">備份與還原</h3>
      <div className="card">
        <p className="muted">瀏覽器不保證永久保留資料（例如手機空間不足、清除瀏覽資料、長期未開啟）。請定期匯出備份，存到「檔案」、雲端硬碟或電腦。</p>
        <div className="row-between">
          <span>上次備份</span>
          {days === null ? <Badge tone={hasData ? 'warn' : 'neutral'}>從未備份</Badge> : <Badge tone={days > 14 ? 'warn' : 'ok'}>{days === 0 ? '今天' : `${days} 天前`}</Badge>}
        </div>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => void run('匯出', async () => setBackupFile(await exportBackup(setBusy)))}><Icon name="share" size={18} /> {busy?.startsWith('打包') || busy === '產生備份檔' ? busy : '匯出完整備份'}</button>
        {backupFile && (
          <div className="backup-ready">
            <p>備份檔已產生：{backupFile.name}（{fmtBytes(backupFile.size)}），包含所有衣服、照片、試穿、穿搭與設定。</p>
            <button className="btn btn-primary" onClick={() => void saveFile(backupFile).then(async (saved) => { if (saved) { await update({ lastBackupAt: Date.now() }); setMsg({ text: '請確認備份檔已存到「檔案」或雲端硬碟。', tone: 'ok' }); } })}>儲存備份檔</button>
          </div>
        )}
        <div className="options compact-opts" role="radiogroup" aria-label="匯入方式">
          <label className="option"><input type="radio" name="imp" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} /><span><b>合併匯入</b><small>保留手機上的資料，只加入備份中沒有的（相同資料會略過）</small></span></label>
          <label className="option"><input type="radio" name="imp" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /><span><b>完整還原</b><small>先清空手機上的資料，再還原成備份當時的狀態（含設定）</small></span></label>
        </div>
        <label className={`btn ${busy ? 'disabled' : ''}`}><Icon name="upload" size={18} /> 選擇備份檔匯入
          <input type="file" accept=".zip,application/zip" hidden disabled={!!busy} onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            if (importMode === 'replace' && !confirm('完整還原會先刪除手機上目前所有的衣服、照片與紀錄。確定嗎？')) return;
            void run('匯入', async () => {
              const r = await importBackup(f, setBusy, importMode);
              setMsg({ text: `匯入完成：衣服 ${r.added.garments ?? 0} 件、全身照 ${r.added.persons ?? 0} 張、試穿 ${r.added.tryons ?? 0} 筆、穿搭 ${r.added.outfits ?? 0} 組、圖片 ${r.images} 張${r.skipped ? `，略過 ${r.skipped} 筆已存在的資料` : ''}${r.missingImages ? `；備份檔缺少 ${r.missingImages} 張圖片` : ''}${r.settingsRestored ? '；設定已還原（重新開啟 App 後生效）' : ''}。`, tone: r.missingImages ? 'err' : 'ok' });
            });
          }} />
        </label>
      </div>

      <h3 className="section-title">圖片壓縮</h3>
      <div className="card options">
        {(['standard', 'compact'] as const).map((k) => (
          <label key={k} className="option">
            <input type="radio" name="q" checked={settings.imageQuality === k} onChange={() => void update({ imageQuality: k })} />
            <span><b>{k === 'standard' ? '標準品質' : '省空間'}</b><small>新照片長邊上限 {IMAGE_PROFILES[k].originalMaxSide}px、JPEG 品質 {Math.round(IMAGE_PROFILES[k].jpegQ * 100)}%{k === 'compact' ? '，約省 30–45% 空間' : ''}</small></span>
          </label>
        ))}
      </div>
      <div className="card">
        <p className="muted">把已存的衣服原圖、全身照、試穿圖重新壓縮成目前的品質設定（去背圖保留透明度不處理；全身照只降品質不縮小，避免辨識結果失準）。</p>
        <button className="btn" disabled={!!busy} onClick={() => void run('壓縮', async () => {
          const p = IMAGE_PROFILES[settings.imageQuality];
          const r = await optimizeImages(p.originalMaxSide, p.jpegQ, setBusy);
          setMsg({ text: r.processed ? `已壓縮 ${r.processed} 張圖片，節省 ${fmtBytes(r.savedBytes)}` : '圖片都已經是目前的品質，不需要再壓縮', tone: 'ok' });
        })}>{busy?.startsWith('壓縮') ? busy : '壓縮現有圖片'}</button>
      </div>

      <h3 className="section-title">重複與殘留資料檢查</h3>
      <div className="card">
        <button className="btn" disabled={!!busy} onClick={() => void run('檢查', async () => setDupes(await scanDuplicates()))}>開始檢查</button>
        {dupes && (
          <div className="dupes">
            {!dupes.orphans.length && !dupes.garmentGroups.length && !dupes.personGroups.length && !dupes.outfitGroups.length && <p className="muted">✓ 沒有重複或殘留的資料</p>}
            {dupes.orphans.length > 0 && (
              <div className="dupe-block">
                <b>沒有被使用的圖片 {dupes.orphans.length} 張（{fmtBytes(dupes.orphans.reduce((s, o) => s + o.bytes, 0))}）</b>
                <p className="muted">通常是儲存過程中斷留下的，可以安全刪除。</p>
                <button className="btn btn-small" onClick={() => void run('清理', async () => { await deleteImages(dupes.orphans.map((o) => o.id)); setDupes(await scanDuplicates()); setMsg({ text: '已清理殘留圖片', tone: 'ok' }); })}>清理</button>
              </div>
            )}
            {dupes.garmentGroups.map((g) => (
              <div key={g.hash} className="dupe-block">
                <b>這些衣服使用同一張照片：</b>
                <ul>{g.garments.map((x) => <li key={x.id}><a href={`#/wardrobe/item/${x.id}`}>{x.name}</a>（{new Date(x.createdAt).toLocaleDateString('zh-TW')}）</li>)}</ul>
                <p className="muted">點進去確認後，可刪除多餘的那件。</p>
              </div>
            ))}
            {dupes.personGroups.map((g) => (
              <div key={g.hash} className="dupe-block">
                <b>重複的全身照：</b>
                <ul>{g.persons.map((x) => <li key={x.id}><a href={`#/tryon/person/${x.id}`}>{x.name}</a></li>)}</ul>
              </div>
            ))}
            {dupes.outfitGroups.map((g) => (
              <div key={g.ids.join()} className="dupe-block">
                <b>相同組合的收藏穿搭 {g.ids.length} 組：</b>{g.names.join('、')}
                <button className="btn btn-small" onClick={() => void run('刪除', async () => { for (const id of g.ids.slice(1)) await deleteOutfit(id); setDupes(await scanDuplicates()); })}>只保留一組</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <h3 className="section-title">清除資料</h3>
      <div className="card">
        <button className="btn" disabled={!!busy} onClick={() => { if (confirm('刪除所有試穿圖與試穿紀錄？（衣服、全身照、收藏穿搭不受影響）')) void run('清除', async () => { await clearTryOns(); setMsg({ text: '已清除試穿紀錄', tone: 'ok' }); }); }}>清除試穿紀錄</button>
        <button className="btn" disabled={!!busy} onClick={() => { if (confirm('清除推薦紀錄？')) void run('清除', async () => { await clearRecommendHistory(); setMsg({ text: '已清除推薦紀錄', tone: 'ok' }); }); }}>清除推薦紀錄</button>
        <button className="btn btn-danger" disabled={!!busy} onClick={() => {
          if (!confirm('確定要刪除所有衣服、照片、試穿結果、穿搭與設定嗎？此動作無法復原。（已下載的 AI 模型會保留）')) return;
          if (!confirm('再確認一次：所有資料將永久刪除。建議先匯出備份。')) return;
          void run('清除', async () => { await clearAllData(); location.reload(); });
        }}><Icon name="trash" size={18} /> 清除所有資料</button>
      </div>
      {busy && <p className="muted center"><span className="spinner" /> {busy}</p>}
    </div>
  );
}
