import { useState } from 'react';
import { DEFAULT_GEMINI_MODEL, getGeminiKey, getGeminiModel, maskKey, setGeminiKey, setGeminiModel } from '../lib/cloud-tryon';

/** 設定頁：雲端 AI 試穿（Gemini）的金鑰。金鑰只存在這支手機，不會進備份檔 */
export function GeminiSettings({ onChange }: { onChange?: (hasKey: boolean) => void } = {}) {
  const [key, setKey] = useState(getGeminiKey());
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState(getGeminiModel());
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    const k = draft.trim();
    // Google AI Studio 新金鑰為 AQ. 開頭，舊金鑰為 AIza 開頭，兩種都接受
    if (!/^(AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z._-]{20,})$/.test(k)) { setMsg('看起來不是 Gemini API 金鑰（應該是 AQ. 或 AIza 開頭的一串英數字，中間不能有空白）。'); return; }
    setGeminiKey(k); setKey(k); setDraft(''); onChange?.(true); setMsg('已儲存。試穿頁會出現「雲端 AI 試穿」，新增衣服也能選付費去背與判斷。');
  }
  function remove() {
    if (!confirm('確定要刪除這支手機上的 Gemini 金鑰嗎？')) return;
    setGeminiKey(''); setKey(''); onChange?.(false); setMsg('已刪除金鑰，雲端 AI 功能已關閉。');
  }

  return (
    <div className="card gemini">
      <p className="muted">
        用 Google Gemini 做雲端 AI 試穿、問 AI 怎麼搭、付費去背與判斷衣服。<b>需要你自己的 Gemini API 金鑰</b>，費用由 Google 向你收取。
        每次都要你按下按鈕並確認費用後，才會把照片傳到 Google。
      </p>
      {key ? (
        <div className="row-between">
          <span>金鑰：<b>{maskKey(key)}</b>（只存在這支手機）</span>
          <button className="btn btn-small btn-danger" onClick={remove}>刪除</button>
        </div>
      ) : (
        <>
          <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder="貼上 AQ. 或 AIza 開頭的金鑰" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Gemini API 金鑰" />
          <button className="btn btn-primary" disabled={!draft.trim()} onClick={save}>儲存金鑰</button>
        </>
      )}
      {msg && <p className="muted small-note" role="status">{msg}</p>}
      <details className="gemini-adv">
        <summary>進階：模型名稱</summary>
        <input className="input" value={model} spellCheck={false} onChange={(e) => setModel(e.target.value)} onBlur={() => { setGeminiModel(model); setModel(getGeminiModel()); }} aria-label="Gemini 模型名稱" />
        <p className="muted small-note">預設 {DEFAULT_GEMINI_MODEL}。Google 停用舊模型時，可以改成新的圖片模型名稱。</p>
      </details>
      <p className="muted small-note">金鑰不會出現在備份檔、程式碼或 GitHub。建議在 Google Cloud 設定預算上限，並把金鑰限制在本網站使用。</p>
    </div>
  );
}
