import { useState } from 'react';
import { DEFAULT_GEMINI_MODEL, getGeminiKey, getGeminiModel, maskKey, setGeminiKey, setGeminiModel } from '../lib/cloud-tryon';

/** 設定頁：雲端 AI 試穿（Gemini）的金鑰。金鑰只存在這支手機，不會進備份檔 */
export function GeminiSettings() {
  const [key, setKey] = useState(getGeminiKey());
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState(getGeminiModel());
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    const k = draft.trim();
    if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(k)) { setMsg('看起來不是 Gemini API 金鑰（應該是 AIza 開頭的一串英數字）。'); return; }
    setGeminiKey(k); setKey(k); setDraft(''); setMsg('已儲存。到試穿頁就能看到「雲端 AI 試穿」按鈕。');
  }
  function remove() {
    if (!confirm('確定要刪除這支手機上的 Gemini 金鑰嗎？')) return;
    setGeminiKey(''); setKey(''); setMsg('已刪除金鑰，雲端 AI 試穿已關閉。');
  }

  return (
    <div className="card gemini">
      <p className="muted">
        用 Google Gemini 重新「畫」出穿上衣服的照片，皺褶與光影更自然。<b>需要你自己的 Gemini API 金鑰</b>，費用由 Google 向你收取（約每張 US$0.04）。
        只有在試穿頁按下按鈕並確認後，才會把那張全身照和衣服照傳到 Google。
      </p>
      {key ? (
        <div className="row-between">
          <span>金鑰：<b>{maskKey(key)}</b>（只存在這支手機）</span>
          <button className="btn btn-small btn-danger" onClick={remove}>刪除</button>
        </div>
      ) : (
        <>
          <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder="貼上 AIza 開頭的金鑰" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Gemini API 金鑰" />
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
