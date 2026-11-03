import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { countAll } from '../lib/db';
import { isIOS, isStandalone, useInstallPrompt } from '../lib/platform';
import { href } from '../lib/router';
import { listGarments } from '../lib/garments';
import { currentSeason, recommend, type Recommendation } from '../recommend/engine';
import { useImageUrl } from '../lib/useImageUrl';
import type { Garment } from '../lib/types';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? '夜深了' : h < 12 ? '早安' : h < 18 ? '午安' : '晚安';
}

export function Home() {
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof countAll>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const install = useInstallPrompt();
  const standalone = isStandalone();
  const [pick, setPick] = useState<Recommendation | null>(null);
  useEffect(() => {
    countAll().then(setCounts, (e: Error) => setErr(e.message));
    // 今日推薦：以日期當亂數種子，同一天看到同一組
    void listGarments().then((gs) => {
      const d = new Date();
      const r = recommend({ garments: gs, mode: 'random', season: currentSeason(d), occasion: 'daily', style: 'any', seed: d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate(), count: 1 });
      setPick(r.items[0] ?? null);
    });
  }, []);
  const today = new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <div className="page">
      <header className="home-hero">
        <p className="eyebrow">{today}</p>
        <h1>{greeting()}，<br />今天想穿什麼？</h1>
      </header>

      {err && <div className="alert alert-err">{err}</div>}

      <section className="stats">
        <a href={href('/wardrobe')} className="stat"><strong>{counts?.garments ?? '–'}</strong><span>件衣服</span></a>
        <a href={href('/outfits')} className="stat"><strong>{counts?.outfits ?? '–'}</strong><span>組穿搭</span></a>
        <a href={href('/outfits')} className="stat"><strong>{counts?.tryons ?? '–'}</strong><span>次試穿</span></a>
      </section>

      {pick && (
        <a href="#/outfits?tab=recommend" className="card today">
          <span className="feature-kicker"><Icon name="sparkle" size={16} /> 今日推薦</span>
          <div className="today-row">
            {[pick.outer, pick.top, pick.dress, pick.bottom].filter(Boolean).slice(0, 3).map((g) => <Thumb key={g!.id} g={g!} />)}
          </div>
          <p>{pick.reasons[0]}</p>
        </a>
      )}

      <a href={href('/tryon')} className="feature-card dark">
        <div>
          <span className="feature-kicker"><Icon name="sparkle" size={16} /> AI 試穿</span>
          <h2>把衣櫥裡的衣服<br />穿到自己身上</h2>
          <p>全程在手機上運算，照片不會離開你的裝置</p>
        </div>
        <Icon name="chevron" />
      </a>

      <a href={href('/wardrobe')} className="feature-card">
        <div>
          <span className="feature-kicker"><Icon name="hanger" size={16} /> 我的衣櫥</span>
          <h2>{counts && counts.garments > 0 ? '整理你的衣服' : '從第一件衣服開始'}</h2>
          <p>拍照、去背、分類，建立你的數位衣櫥</p>
        </div>
        <Icon name="chevron" />
      </a>

      {!standalone && (
        <section className="card install">
          <h2><Icon name="download" size={20} /> 安裝到主畫面</h2>
          {install.canPrompt ? (
            <>
              <p>安裝後可像 App 一樣全螢幕開啟，並可離線使用。</p>
              <button className="btn btn-primary" onClick={() => void install.prompt()}>安裝 App</button>
            </>
          ) : isIOS ? (
            <ol className="steps">
              <li>點 Safari 的 <b>分享</b> 按鈕 <Icon name="share" size={16} /></li>
              <li>選擇 <b>加入主畫面</b></li>
              <li>從主畫面開啟，資料較不會被瀏覽器清除</li>
            </ol>
          ) : (
            <p>請在瀏覽器選單中選擇「安裝應用程式」或「加到主畫面」。</p>
          )}
        </section>
      )}

      <p className="privacy-note"><Icon name="shield" size={16} /> 所有照片與資料只儲存在這支手機，不使用雲端。</p>
    </div>
  );
}

function Thumb({ g }: { g: Garment }) {
  const url = useImageUrl(g.thumbImageId);
  return <div className="today-thumb">{url && <img src={url} alt={g.name} />}<span>{g.name}</span></div>;
}
