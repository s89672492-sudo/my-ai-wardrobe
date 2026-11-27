import { useEffect, useRef, useState } from 'react';
import { askStylist, getGeminiKey, parseStylistReply, type StylistItem, type StylistTurn } from '../lib/cloud-tryon';
import { belongsTo, useCouple } from '../lib/couple';
import { getImageBlob, listGarments } from '../lib/garments';
import { listPersons } from '../lib/persons';
import { href, navigate } from '../lib/router';
import { CATEGORIES, SEASON_LABEL, type Garment } from '../lib/types';
import { currentSeason } from '../recommend/engine';
import { useImageUrl } from '../lib/useImageUrl';
import { Avatar } from './Mascot';
import { Icon } from './Icon';

interface Msg { role: 'user' | 'model'; text: string; picks?: Garment[] }
const SUGGESTIONS = ['明天約會，幫我搭一套', '上班穿什麼比較正式？', '這週末去海邊玩怎麼穿？', '我缺什麼單品？'];

/** 問 AI 怎麼搭（Gemini 文字模型，會傳衣服縮圖）。沒設定金鑰時顯示說明 */
export function AiStylist() {
  const couple = useCouple();
  const [hasKey] = useState(() => !!getGeminiKey());
  const [who, setWho] = useState<'her' | 'him'>('her');
  const [garments, setGarments] = useState<Garment[] | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { void listGarments().then(setGarments); return () => abort.current?.abort(); }, []);

  if (!hasKey) {
    return (
      <div className="card ai-stylist">
        <h2 className="card-title">問 AI 怎麼搭</h2>
        <p className="muted small-note">在「設定 → 雲端 AI 試穿」貼上 Gemini 金鑰後，就能用聊天的方式問 AI 怎麼用你衣櫥裡的衣服搭配。</p>
        <a className="btn" href={href('/settings')}>到設定頁</a>
      </div>
    );
  }

  const mine = (garments ?? []).filter((g) => belongsTo(g.owner, who));
  const label = (g: Garment) => CATEGORIES.find((c) => c.id === g.category)?.label ?? '';

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    if (!mine.length) { setErr('衣櫥裡還沒有衣服，先新增幾件再問。'); return; }
    if (!msgs.length && !confirm(`會把 ${mine.length} 件衣服的縮圖與名稱、顏色等資料傳到 Google（Gemini）分析，費用很低（約 NT$0.1–0.3／次），由你的 Google 帳戶支付。要繼續嗎？`)) return;
    setErr(null); setBusy(true); setQ('');
    const next: Msg[] = [...msgs, { role: 'user', text: t }];
    setMsgs(next);
    abort.current = new AbortController();
    try {
      const items: StylistItem[] = [];
      const refOf = new Map<string, Garment>();
      for (const [i, g] of mine.entries()) {
        const blob = await getImageBlob(g.thumbImageId);
        if (!blob) continue;
        const ref = `#${i + 1}`;
        refOf.set(ref, g);
        items.push({ ref, image: blob, desc: [g.name, label(g), g.color, g.seasons.map((s) => SEASON_LABEL[s]).join(''), (g.styles ?? []).join('/')].filter(Boolean).join('，') });
      }
      const turns: StylistTurn[] = next.map((m) => ({ role: m.role, text: m.text }));
      const reply = await askStylist(items, turns, { who: who === 'her' ? couple.herName : couple.himName, season: `${SEASON_LABEL[currentSeason()]}季`, signal: abort.current.signal });
      const { body, refs } = parseStylistReply(reply);
      setMsgs([...next, { role: 'model', text: body, picks: refs.map((r) => refOf.get(r)).filter(Boolean) as Garment[] }]);
    } catch (e) {
      setErr((e as Error).message);
      setMsgs(msgs); setQ(t);
    } finally { setBusy(false); abort.current = null; }
  }

  async function tryOn(picks: Garment[]) {
    const ps = (await listPersons()).filter((p) => p.analysis);
    if (!ps.length) { if (confirm('還沒有可用的全身照，要先新增一張嗎？')) navigate('/tryon/person/new'); return; }
    navigate(`/tryon/studio/${ps[0]!.id}/g/${picks.map((g) => g.id).join(',')}`);
  }

  return (
    <section className="card ai-stylist">
      <h2 className="card-title">問 AI 怎麼搭</h2>
      <div className="owner-tabs two" role="tablist" aria-label="幫誰搭配">
        {(['her', 'him'] as const).map((w) => (
          <button key={w} role="tab" aria-selected={who === w} className={`owner-tab who-${w} ${who === w ? 'on' : ''}`} onClick={() => { setWho(w); setMsgs([]); }}><Avatar who={w} size={24} /> {w === 'her' ? couple.herName : couple.himName}</button>
        ))}
      </div>
      <ul className="chat" aria-live="polite">
        {msgs.map((m, i) => (
          <li key={i} className={`bubble-msg ${m.role}`}>
            <p>{m.text}</p>
            {m.picks && m.picks.length > 0 && (
              <>
                <div className="chat-picks">{m.picks.map((g) => <Pick key={g.id} g={g} />)}</div>
                <button className="btn btn-small btn-primary" onClick={() => void tryOn(m.picks!)}><Icon name="sparkle" size={16} /> 試穿這套</button>
              </>
            )}
          </li>
        ))}
        {busy && <li className="bubble-msg model"><p><span className="spinner" /> AI 正在看你的衣櫥…</p></li>}
      </ul>
      {!msgs.length && <div className="chips tight">{SUGGESTIONS.map((s) => <button key={s} className="chip" disabled={busy} onClick={() => void send(s)}>{s}</button>)}</div>}
      {err && <div className="alert alert-err" role="alert">{err}</div>}
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void send(q); }}>
        <input className="input" value={q} maxLength={200} placeholder="例如：20 度去看電影怎麼穿？" onChange={(e) => setQ(e.target.value)} aria-label="問 AI 怎麼搭" />
        <button className="btn btn-primary btn-small" disabled={busy || !q.trim()}>送出</button>
      </form>
      <details className="more-info"><summary>更多資訊</summary><p>會把{who === 'her' ? couple.herName : couple.himName}的衣服縮圖傳到 Google Gemini 分析，每次約 NT$0.1–0.3。AI 建議僅供參考。</p></details>
    </section>
  );
}

function Pick({ g }: { g: Garment }) {
  const url = useImageUrl(g.thumbImageId);
  return <a className="chat-pick" href={`#/wardrobe/item/${g.id}`}>{url && <img src={url} alt="" />}<span>{g.name}</span></a>;
}
