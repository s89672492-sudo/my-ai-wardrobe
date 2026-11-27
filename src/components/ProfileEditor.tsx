import { useState } from 'react';
import { CropView } from './CropView';
import { Avatar } from './Mascot';
import { deleteAvatarImage, saveAvatarImage } from '../lib/couple';
import { ctx2d, decodeImageFile, makeCanvas } from '../lib/image';
import { useSettings } from '../lib/settings';

/** 設定我的名字與頭像。頭像只存在這支手機，不會上傳、也不會出現在 GitHub。 */
export function ProfileEditor() {
  const { settings, update } = useSettings();
  const [crop, setCrop] = useState<HTMLCanvasElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cur = { name: '', ...settings.me };
  const save = (p: Partial<typeof cur>) => update({ me: { ...cur, ...p } });

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    try {
      const bmp = await decodeImageFile(file, 1600);
      const c = makeCanvas(bmp.width, bmp.height);
      ctx2d(c).drawImage(bmp, 0, 0);
      bmp.close();
      setCrop(c);
    } catch (e) { setErr(`無法讀取這張圖片：${(e as Error).message}`); }
  }

  async function done(c: HTMLCanvasElement) {
    try {
      const id = await saveAvatarImage(c, cur.avatarId);
      await save({ avatarId: id });
      setCrop(null);
    } catch (e) { setErr(`儲存頭像失敗：${(e as Error).message}`); }
  }

  async function reset() {
    if (cur.avatarId) await deleteAvatarImage(cur.avatarId).catch(() => {});
    await save({ avatarId: undefined });
  }

  if (crop) {
    return (
      <div className="card">
        <p className="muted center">框出頭像範圍</p>
        <CropView source={crop} onBack={() => setCrop(null)} onDone={(c) => void done(c)} doneLabel="使用這個頭像" />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="profile-edit">
        <Avatar size={72} />
        <div className="profile-fields">
          <input className="input" aria-label="我的名字" value={cur.name} maxLength={10} placeholder="你的名字（選填）" onChange={(e) => void save({ name: e.target.value })} />
          <div className="row-2">
            <label className="btn btn-small">
              換頭像
              <input type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {cur.avatarId && <button className="btn btn-small" onClick={() => void reset()}>移除頭像</button>}
          </div>
        </div>
      </div>
      {err && <div className="alert alert-err" style={{ marginTop: 10 }}>{err}</div>}
      <p className="muted small-note" style={{ marginTop: 10 }}>頭像圖片只存在這支手機，不會上傳。</p>
    </div>
  );
}
