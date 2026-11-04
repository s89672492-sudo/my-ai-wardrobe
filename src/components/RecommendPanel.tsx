import { useEffect, useMemo, useState } from 'react';
import { currentSeason, MODE_ZH, OCCASION_ZH, recommend, type Mode, type Occasion, type Recommendation } from '../recommend/engine';
import { listGarments } from '../lib/garments';
import { addHistory, listHistory } from '../lib/history';
import { saveOutfit } from '../lib/outfits';
import { listPersons } from '../lib/persons';
import { href, navigate } from '../lib/router';
import { SEASON_LABEL, SEASONS, type Garment, type Season } from '../lib/types';
import { useImageUrl } from '../lib/useImageUrl';
import { EmptyState } from './ui';
import { Icon } from './Icon';
import { Avatar } from './Mascot';
import { belongsTo, useCouple } from '../lib/couple';

type StylePref = 'any' | 'casual' | 'formal';

/** 本機規則引擎產生的穿搭推薦（不使用雲端 AI） */
export function RecommendPanel() {
  const [garments, setGarments] = useState<Garment[] | null>(null);
  const [mode, setMode] = useState<Mode>('color');
  const [season, setSeason] = useState<Season>(currentSeason());
  const [occasion, setOccasion] = useState<Occasion>('daily');
  const [style, setStyle] = useState<StylePref>('any');
  const [seed, setSeed] = useState(() => Date.now() % 100000);
  const [recent, setRecent] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [who, setWho] = useState<'her' | 'him'>(() => { try { return (sessionStorage.getItem('rec-who') as 'her' | 'him') || 'her'; } catch { return 'her'; } });
  const couple = useCouple();
  useEffect(() => { try { sessionStorage.setItem('rec-who', who); } catch { /* ignore */ } }, [who]);
  // 只用這個人的衣服與共用衣服搭配
  const mine = useMemo(() => garments?.filter((g) => belongsTo(g.owner, who)) ?? null, [garments, who]);

  useEffect(() => {
    void listGarments().then(setGarments);
    void listHistory('recommend', 30).then((h) => setRecent(h.map((x) => x.refId.replace(/^rec:/, ''))));
  }, []);

  const result = useMemo(() => (mine ? recommend({ garments: mine, mode, season, occasion, style, seed, count: 4, recent }) : null), [mine, mode, season, occasion, style, seed, recent]);

  function reroll() {
    // 這次看過的組合先排後面，換一組才會不同
    setRecent((r) => [...new Set([...(result?.items.map((i) => i.key) ?? []), ...r])].slice(0, 60));
    setSeed((s) => s + 1);
  }

  async function tryOn(r: Recommendation) {
    const ps = (await listPersons()).filter((p) => p.analysis && !p.analysis.checks.some((c) => c.level === 'error'));
    if (!ps.length) { if (confirm('還沒有可用的全身照，要先新增一張嗎？')) navigate('/tryon/person/new'); return; }
    await addHistory('recommend', `rec:${r.key}`);
    navigate(`/tryon/studio/${ps[0]!.id}/g/${r.garmentIds.join(',')}`);
  }
  async function save(r: Recommendation) {
    const names = [r.outer, r.top, r.dress, r.bottom].filter(Boolean).map((g) => g!.name);
    await saveOutfit({ name: `${couple.nameOf(who)}・${mode === 'occasion' ? OCCASION_ZH[occasion] : MODE_ZH[mode]}：${names.join(' + ')}`, garmentIds: r.garmentIds, tags: [mode, season, who, ...(mode === 'occasion' ? [occasion] : [])], source: 'recommend' });
    await addHistory('recommend', `rec:${r.key}`);
    setSavedKeys((s) => new Set(s).add(r.key));
    setMsg('已加入收藏穿搭');
    setTimeout(() => setMsg(null), 2200);
  }

  return (
    <div className="recommend">
      <p className="muted small-note"><Icon name="shield" size={14} /> 依你衣櫥裡的衣服，在手機上用規則計算，不使用雲端 AI</p>
      <div className="owner-tabs two" role="tablist" aria-label="幫誰搭配">
        {(['her', 'him'] as const).map((w) => (
          <button key={w} role="tab" aria-selected={who === w} className={`owner-tab ${who === w ? 'on' : ''}`} onClick={() => setWho(w)}><Avatar who={w} size={26} /> 幫{couple.nameOf(w)}搭</button>
        ))}
      </div>
      <div className="segmented four" role="tablist" aria-label="推薦方式" style={{ marginTop: 10 }}>
        {(['random', 'color', 'season', 'occasion'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{MODE_ZH[m].replace('搭配', '')}</button>
        ))}
      </div>
      <div className="chips tight" aria-label="季節">
        {SEASONS.map((s) => <button key={s} className={season === s ? 'chip on' : 'chip'} onClick={() => setSeason(s)}>{SEASON_LABEL[s]}{s === currentSeason() ? '（現在）' : ''}</button>)}
      </div>
      {mode === 'occasion' ? (
        <div className="chips tight" aria-label="場合">
          {(Object.keys(OCCASION_ZH) as Occasion[]).map((o) => <button key={o} className={occasion === o ? 'chip on' : 'chip'} onClick={() => setOccasion(o)}>{OCCASION_ZH[o]}</button>)}
        </div>
      ) : (
        <div className="chips tight" aria-label="風格">
          {([['any', '風格不限'], ['casual', '休閒風格'], ['formal', '正式風格']] as const).map(([k, l]) => <button key={k} className={style === k ? 'chip on' : 'chip'} onClick={() => setStyle(k)}>{l}</button>)}
        </div>
      )}
      {msg && <div className="inline-toast" role="status">{msg}</div>}

      {garments && result?.problem && (
        <EmptyState icon="hanger" mascot={who} title="還沒辦法推薦" action={<a className="btn btn-primary" href={href('/wardrobe/new')}>新增衣服</a>}>{result.problem}</EmptyState>
      )}
      {result?.items.map((r, i) => <RecCard key={r.key} r={r} rank={i + 1} saved={savedKeys.has(r.key)} onTry={() => void tryOn(r)} onSave={() => void save(r)} />)}
      {result && result.items.length > 0 && (result.total > result.items.length
        ? <button className="btn" onClick={reroll}><Icon name="rotate" size={18} /> 換一組</button>
        : <p className="muted center">符合目前條件的組合只有 {result.total} 組。新增衣服、補上季節標籤或換個條件，可以看到更多搭配。</p>)}
      {result && result.items.length > 0 && <p className="disclaimer">推薦依顏色、季節、正式程度等規則計算，只會使用你衣櫥中已有的衣服。為衣服加上顏色、季節與風格標籤，推薦會更準。</p>}
    </div>
  );
}

function RecCard({ r, rank, saved, onTry, onSave }: { r: Recommendation; rank: number; saved: boolean; onTry: () => void; onSave: () => void }) {
  const pieces = [r.outer, r.top, r.dress, r.bottom, r.shoes, r.bag].filter(Boolean) as Garment[];
  return (
    <article className="rec-card card">
      <div className="rec-head"><span className="rec-rank">{rank}</span><span className="rec-score">推薦度 {Math.round(Math.max(0, Math.min(1, r.score)) * 100)}</span></div>
      <div className={`rec-collage n${Math.min(pieces.length, 4)}`}>
        {pieces.slice(0, 4).map((g) => <Piece key={g.id} g={g} />)}
      </div>
      <p className="rec-names">{pieces.map((g) => g.name).join(' + ')}</p>
      <ul className="rec-reasons">{r.reasons.map((t) => <li key={t}>{t}</li>)}</ul>
      <div className="row-2">
        <button className="btn btn-primary" onClick={onTry}><Icon name="sparkle" size={18} /> 試穿</button>
        <button className="btn" disabled={saved} onClick={onSave}><Icon name="heart" size={18} filled={saved} /> {saved ? '已收藏' : '收藏'}</button>
      </div>
    </article>
  );
}

function Piece({ g }: { g: Garment }) {
  const url = useImageUrl(g.thumbImageId);
  return <div className="rec-piece">{url && <img src={url} alt={g.name} />}</div>;
}
