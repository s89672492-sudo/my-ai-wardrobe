import { getDB } from './db';
import { canvasToBlob, ctx2d, makeCanvas, uid } from './image';
import { useSettings } from './settings';

/** 我的名字與頭像（個人衣櫥；名字可留空） */
export function useMe(): { name: string; avatarId?: string } {
  const { settings } = useSettings();
  return { name: settings.me?.name.trim() ?? '', avatarId: settings.me?.avatarId };
}

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
