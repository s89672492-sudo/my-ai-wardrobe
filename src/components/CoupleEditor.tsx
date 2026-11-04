import { useState } from 'react';
import { CropView } from './CropView';
import { Avatar } from './Mascot';
import { deleteAvatarImage, saveAvatarImage, useCouple } from '../lib/couple';
import { ctx2d, decodeImageFile, makeCanvas } from '../lib/image';
import { useSettings } from '../lib/settings';
import { DEFAULT_COUPLE } from '../lib/types';

/** 設定兩人的暱稱與頭像。頭像只存在這支手機，不會上傳、也不會出現在 GitHub。 */
export function CoupleEditor() {
  const { settings, update } = useSettings();
  const couple = useCouple();
  const [crop, setCrop] = useState<{ who: 'her' | 'him'; src: HTMLCanvasElement } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cur = { ...DEFAULT_COUPLE, ...settings.couple };

  const save = (p: Partial<typeof cur>) => update({ couple: { ...cur, ...p } });

  async function pick(who: 'her' | 'him', file: File | undefined) {
    if (!file) return;
    setErr(null);
    try {
      const bmp = await decodeImageFile(file, 1600);
      const c = makeCanvas(bmp.width, bmp.height);
      ctx2d(c).drawImage(bmp, 0, 0);
      bmp.close();
      setCrop({ who, src: c });
    } catch (e) { setErr(`無法讀取這張圖片：${(e as Error).message}`); }
  }

  async function done(c: HTMLCanvasElement) {
    if (!crop) return;
    const key = crop.who === 'her' ? 'herAvatarId' : 'himAvatarId';
    try {
      const id = await saveAvatarImage(c, cur[key]);
      await save({ [key]: id });
      setCrop(null);
    } catch (e) { setErr(`儲存頭像失敗：${(e as Error).message}`); }
  }

  async function reset(who: 'her' | 'him') {
    const key = who === 'her' ? 'herAvatarId' : 'himAvatarId';
    if (cur[key]) await deleteAvatarImage(cur[key]!).catch(() => {});
    await save({ [key]: undefined });
  }

  if (crop) {
    return (
      <div className="card">
        <p className="muted center">框出{crop.who === 'her' ? couple.herName : couple.himName}的頭像範圍</p>
        <CropView source={crop.src} onBack={() => setCrop(null)} onDone={(c) => void done(c)} doneLabel="使用這個頭像" />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="couple-edit">
        {(['her', 'him'] as const).map((who) => {
          const nameKey = who === 'her' ? 'herName' : 'himName';
          const hasAvatar = !!cur[who === 'her' ? 'herAvatarId' : 'himAvatarId'];
          return (
            <div key={who} className="couple-person">
              <Avatar who={who} size={72} />
              <input aria-label={who === 'her' ? '她的暱稱' : '他的暱稱'} value={cur[nameKey]} maxLength={10} placeholder={DEFAULT_COUPLE[nameKey]} onChange={(e) => void save({ [nameKey]: e.target.value })} />
              <label className="btn btn-small">
                換頭像
                <input type="file" accept="image/*" hidden onChange={(e) => { void pick(who, e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {hasAvatar && <button className="link-btn" onClick={() => void reset(who)}>改回小貓</button>}
            </div>
          );
        })}
      </div>
      {err && <div className="alert alert-err" style={{ marginTop: 10 }}>{err}</div>}
      <p className="muted small-note" style={{ marginTop: 10 }}>頭像圖片只存在這支手機，不會上傳。衣服可以標記是誰的，衣櫥與穿搭推薦就能分開看。</p>
    </div>
  );
}
