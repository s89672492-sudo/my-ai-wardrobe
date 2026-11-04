import { getDB } from './db';
import { canvasToBlob, ctx2d, makeCanvas, uid } from './image';
import { useSettings } from './settings';
import { DEFAULT_COUPLE, type CoupleSettings, type Owner } from './types';

/** 兩人的暱稱與頭像（未設定時用預設暱稱） */
export function useCouple(): CoupleSettings & { nameOf: (o: Owner) => string } {
  const { settings } = useSettings();
  const c = { ...DEFAULT_COUPLE, ...settings.couple };
  const herName = c.herName.trim() || DEFAULT_COUPLE.herName;
  const himName = c.himName.trim() || DEFAULT_COUPLE.himName;
  return { ...c, herName, himName, nameOf: (o) => (o === 'her' ? herName : o === 'him' ? himName : '共用') };
}

/** 衣服是否屬於某人（共用或未設定的衣服兩人都算） */
export const belongsTo = (owner: Owner | undefined, who: 'her' | 'him') => !owner || owner === 'both' || owner === who;


/** 把裁切後的圖片縮成 256×256 正方形頭像（PNG，保留透明背景），存入本機 IndexedDB */
export async function saveAvatarImage(src: HTMLCanvasElement, previousId?: string): Promise<string> {
  const S = 256;
  const c = makeCanvas(S, S);
  const x = ctx2d(c);
  const k = Math.min(S / src.width, S / src.height);
  const w = src.width * k, h = src.height * k;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, (S - w) / 2, (S - h) / 2, w, h);
  const blob = await canvasToBlob(c, 'image/png');
  const db = await getDB();
  const id = uid();
  const tx = db.transaction('images', 'readwrite');
  await tx.store.put({ id, kind: 'avatar', blob, width: S, height: S, hash: '', createdAt: Date.now() });
  if (previousId) await tx.store.delete(previousId);
  await tx.done;
  return id;
}

export async function deleteAvatarImage(id: string) {
  const db = await getDB();
  await db.delete('images', id);
}
