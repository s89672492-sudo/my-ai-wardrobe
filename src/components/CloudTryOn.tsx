import { useEffect, useRef, useState } from 'react';
import { cloudTryOn, getGeminiKey, type CloudGarment } from '../lib/cloud-tryon';
import { recordMetric } from '../lib/metrics';
import { Icon } from './Icon';

/**
 * 試穿頁的「雲端 AI 試穿」：沒設定金鑰時不顯示。按下後先確認（照片會傳到 Google），
 * 結果可存到試穿紀錄或分享。
 */
export function CloudTryOn({ photo, garments, onSave, onShare }: {
  photo: HTMLCanvasElement | null;
  garments: CloudGarment[];
  onSave: (c: HTMLCanvasElement) => Promise<void>;
  onShare: (b: Blob) => Promise<void>;
}) {
  const [hasKey] = useState(() => !!getGeminiKey());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [extra, setExtra] = useState('');
  const [saved, setSaved] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => { abort.current?.abort(); }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (!hasKey || !photo || !garments.length) return null;

  async function run() {
    if (!confirm(`雲端 AI 試穿會把這張全身照和 ${garments.length} 件衣服的照片傳到 Google（Gemini）處理，費用由你的 Google 帳戶支付（約每張 US$0.04）。要繼續嗎？`)) return;
    setBusy(true); setErr(null); setSaved(false);
    abort.current = new AbortController();
    const t0 = performance.now();
    try {
      const b = await cloudTryOn(photo!, garments, { extra: extra.trim(), signal: abort.current.signal });
      setBlob(b);
      setUrl(URL.createObjectURL(b));
      recordMetric('cloud', performance.now() - t0, `${garments.length} 件`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); abort.current = null; }
  }

  async function save() {
    if (!blob) return;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0); bmp.close();
    await onSave(c);
    setSaved(true);
  }

  return (
    <section className="card cloud-tryon">
      <span className="cloud-badge">雲端 AI · Gemini</span>
      <p className="muted small-note">用生成式 AI 重新畫出穿上這些衣服的照片（皺褶、光影較自然）。照片會傳到 Google；AI 偶爾會改到臉或背景。</p>
      <input className="input" value={extra} maxLength={120} placeholder="補充說明（選填），例如：上衣紮進褲子、袖子捲起" onChange={(e) => setExtra(e.target.value)} aria-label="雲端 AI 試穿補充說明" />
      {busy
        ? <button className="btn" onClick={() => abort.current?.abort()}><span className="spinner" /> 雲端產生中…（約 10–30 秒）按此取消</button>
        : <button className="btn btn-primary" onClick={() => void run()}><Icon name="sparkle" size={18} /> {url ? '重新產生' : '雲端 AI 試穿'}</button>}
      {err && <div className="alert alert-err" role="alert">{err}</div>}
      {url && (
        <div className="cloud-result">
          <img src={url} alt="雲端 AI 試穿結果" />
          <div className="row-2">
            <button className="btn btn-primary" disabled={saved} onClick={() => void save()}>{saved ? '已儲存' : '存到試穿紀錄'}</button>
            <button className="btn" onClick={() => blob && void onShare(blob)}><Icon name="share" size={18} /> 分享圖片</button>
          </div>
          <p className="disclaimer">這張是 Google Gemini 生成的圖片，不是真實照片；衣服細節、合身度與長相可能和實際不同。</p>
        </div>
      )}
    </section>
  );
}
