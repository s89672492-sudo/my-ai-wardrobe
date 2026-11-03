/** 試穿結果（合成圖、縮圖、使用的衣服與調整）存入 IndexedDB，並寫入歷史紀錄。 */
import { getDB } from './db';
import { canvasToBlob, imageProfile, makeThumbnail, uid } from './image';
import type { HistoryEntry, OutfitLayerOptions, StoredImage, TryOnLayerRecord, TryOnResult } from './types';

export async function saveTryOn(personId: string, layers: TryOnLayerRecord[], result: HTMLCanvasElement, options?: OutfitLayerOptions): Promise<TryOnResult> {
  const now = Date.now();
  const blob = await canvasToBlob(result, 'image/jpeg', imageProfile().tryonQ);
  const thumb = await makeThumbnail(result);
  const img: StoredImage = { id: uid(), kind: 'tryon', blob, width: result.width, height: result.height, hash: '', createdAt: now };
  const th: StoredImage = { id: uid(), kind: 'thumbnail', blob: thumb, width: 480, height: 640, hash: '', createdAt: now };
  const t: TryOnResult = { id: uid(), personId, garmentIds: layers.map((l) => l.garmentId), layers, options, imageId: img.id, thumbImageId: th.id, createdAt: now };
  const h: HistoryEntry = { id: uid(), type: 'tryon', refId: t.id, createdAt: now };
  const db = await getDB();
  const tx = db.transaction(['images', 'tryons', 'history'], 'readwrite');
  try {
    await Promise.all([tx.objectStore('images').put(img), tx.objectStore('images').put(th), tx.objectStore('tryons').put(t), tx.objectStore('history').put(h), tx.done]);
  } catch (e) {
    throw (e as DOMException)?.name === 'QuotaExceededError' ? new Error('手機儲存空間不足，無法儲存試穿結果') : e;
  }
  return t;
}

export async function listTryOns(): Promise<TryOnResult[]> {
  return (await (await getDB()).getAllFromIndex('tryons', 'byCreatedAt')).reverse();
}

export async function deleteTryOn(id: string) {
  const db = await getDB();
  const tx = db.transaction(['images', 'tryons', 'history'], 'readwrite');
  const t = await tx.objectStore('tryons').get(id);
  if (t) {
    await tx.objectStore('images').delete(t.imageId);
    await tx.objectStore('images').delete(t.thumbImageId);
    await tx.objectStore('tryons').delete(id);
    for (const h of await tx.objectStore('history').getAll()) if (h.refId === id) await tx.objectStore('history').delete(h.id);
  }
  await tx.done;
}
