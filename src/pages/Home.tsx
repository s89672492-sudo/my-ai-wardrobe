import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { countAll } from '../lib/db';
import { isIOS, isStandalone, useInstallPrompt } from '../lib/platform';
import { href } from '../lib/router';
import { useSettings } from '../lib/settings';
import { listGarments } from '../lib/garments';
import { currentSeason, recommend, type Recommendation } from '../recommend/engine';
import { useImageUrl } from '../lib/useImageUrl';
import type { Garment } from '../lib/types';
import { Avatar } from '../components/Mascot';
import { useMe } from '../lib/couple';

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
  const { settings } = useSettings();
  const me = useMe();
  const backupDays = settings.lastBackupAt ? Math.floor((Date.now() - settings.lastBackupAt) / 86400000) : null;
  const needBackup = !!counts && counts.garments + counts.persons > 0 && (backupDays === null || backupDays > 14);
  useEffect(() => {
    countAll().then(setCounts, (e: Error) => setErr(e.message));
    // 今日推薦：以日期當亂數種子，同一天看到同一組
    void listGarments().then((gs) => {
      const d = new Date();
      const seed = d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate();
      setPick(recommend({ garments: gs, mode: 'random', season: currentSeason(d), occasion: 'daily', style: 'any', seed, count: 1 }).items[0] ?? null);
    });
  }, []);
  const today = new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <div className="page">
      <header className="greet">
        <p className="greet-date">{today}</p>
        <h1>{greeting()}</h1>
        <p className="greet-names"><Avatar size={24} /> {me.name ? `${me.name}，` : ''}今天想穿什麼？</p>
      </header>

      <nav className="shortcuts" aria-label="快速開始">
        <a href={href('/wardrobe/new')} className="shortcut"><Icon name="camera" size={22} /><span><b>新增衣服</b><small>拍照或從相簿選擇</small></span><Icon name="chevron" size={18} /></a>
        <a href={href('/tryon')} className="shortcut"><Icon name="sparkle" size={22} /><span><b>AI 試穿</b><small>把衣服穿到全身照上</small></span><Icon name="chevron" size={18} /></a>
        <a href="#/outfits?tab=recommend" className="shortcut"><Icon name="heart" size={22} /><span><b>問 AI 怎麼搭</b><small>用你衣櫥裡的衣服搭一套</small></span><Icon name="chevron" size={18} /></a>
      </nav>

      {err && <div className="alert alert-err">{err}</div>}
      {needBackup && (
        <a className="alert alert-warn backup-nudge" href={href('/settings/data')}>
          <Icon name="download" size={18} /> {backupDays === null ? '你的衣櫥資料還沒有備份過' : `上次備份是 ${backupDays} 天前`}，資料只存在這支手機，建議匯出備份 ›
        </a>
      )}

      <section className="stats">
        <a href={href('/wardrobe')} className="stat"><strong>{counts?.garments ?? '–'}</strong><span>件衣服</span></a>
        <a href={href('/outfits')} className="stat"><strong>{counts?.outfits ?? '–'}</strong><span>組穿搭</span></a>
        <a href={href('/outfits')} className="stat"><strong>{counts?.tryons ?? '–'}</strong><span>次試穿</span></a>
      </section>

      {pick && (
        <a href="#/outfits?tab=recommend" className="card today">
          <h2 className="today-title">今日推薦</h2>
          <div className="today-pick">
            <div className="today-row">
              {[pick.outer, pick.top, pick.dress, pick.bottom].filter(Boolean).slice(0, 3).map((g) => <Thumb key={g!.id} g={g!} />)}
            </div>
            <p>{pick.reasons[0]}</p>
          </div>
        </a>
      )}

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

      <p className="privacy-note"><Icon name="shield" size={16} /> 照片與資料都存在這支手機</p>
    </div>
  );
}

function Thumb({ g }: { g: Garment }) {
  const url = useImageUrl(g.thumbImageId);
  return <div className="today-thumb">{url && <img src={url} alt={g.name} />}<span>{g.name}</span></div>;
}

