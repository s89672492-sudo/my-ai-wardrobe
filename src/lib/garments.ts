/** 衣服 CRUD：資料與圖片同一筆交易寫入 IndexedDB，避免殘留孤兒圖片。 */
import { getDB } from './db';
import { uid } from './image';
import type { Garment, ImageKind, StoredImage } from './types';

export type GarmentMeta = Pick<Garment, 'name' | 'category' | 'color' | 'brand' | 'size' | 'seasons' | 'notes' | 'favorite' | 'styles' | 'owner'>;
export interface GarmentImages {
  original: { blob: Blob; width: number; height: number; hash: string };
  cutout: { blob: Blob; width: number; height: number } | null;
  thumb: { blob: Blob; width: number; height: number };
}

const img = (kind: ImageKind, d: { blob: Blob; width: number; height: number; hash?: string }, now: number): StoredImage =>
  ({ id: uid(), kind, blob: d.blob, width: d.width, height: d.height, hash: d.hash ?? '', createdAt: now });

function quotaError(e: unknown): Error {
  const name = (e as DOMException)?.name;
  if (name === 'QuotaExceededError') return new Error('手機儲存空間不足，無法儲存。請刪除部分衣服或釋放手機空間。');
  return e instanceof Error ? e : new Error(String(e));
}

/** 用原始檔案雜湊找可能重複的衣服 */
export async function findDuplicate(hash: string): Promise<Garment | null> {
  const db = await getDB();
  const imgs = await db.getAllFromIndex('images', 'byHash', hash);
  for (const i of imgs) {
    if (i.kind !== 'garment-original') continue;
    const all = await db.getAll('garments');
    const g = all.find((x) => x.originalImageId === i.id);
    if (g) return g;
  }
  return null;
}

export async function createGarment(meta: GarmentMeta, images: GarmentImages): Promise<Garment> {
  const db = await getDB();
  const now = Date.now();
  const o = img('garment-original', images.original, now);
  const c = images.cutout ? img('garment-cutout', images.cutout, now) : null;
  const t = img('thumbnail', images.thumb, now);
  const g: Garment = { ...meta, id: uid(), originalImageId: o.id, cutoutImageId: c?.id ?? null, thumbImageId: t.id, createdAt: now, updatedAt: now };
  try {
    const tx = db.transaction(['garments', 'images'], 'readwrite');
    await Promise.all([tx.objectStore('images').put(o), c && tx.objectStore('images').put(c), tx.objectStore('images').put(t), tx.objectStore('garments').put(g), tx.done]);
  } catch (e) { throw quotaError(e); }
  return g;
}

export async function getGarment(id: string) {
  return (await getDB()).get('garments', id);
}

export async function listGarments(): Promise<Garment[]> {
  const db = await getDB();
  return (await db.getAllFromIndex('garments', 'byCreatedAt')).reverse();
}

/** 更新資料；若提供新圖片則替換並刪除舊圖片 */
export async function updateGarment(id: string, meta: Partial<GarmentMeta>, images?: Partial<GarmentImages>): Promise<Garment> {
  const db = await getDB();
  const tx = db.transaction(['garments', 'images'], 'readwrite');
  const gs = tx.objectStore('garments'), is = tx.objectStore('images');
  const old = await gs.get(id);
  if (!old) throw new Error('找不到這件衣服，可能已被刪除');
  const now = Date.now();
  const g: Garment = { ...old, ...meta, updatedAt: now };
  const remove: string[] = [];
  if (images?.original) { const o = img('garment-original', images.original, now); await is.put(o); remove.push(old.originalImageId); g.originalImageId = o.id; }
  if (images?.cutout !== undefined) {
    if (old.cutoutImageId) remove.push(old.cutoutImageId);
    if (images.cutout) { const c = img('garment-cutout', images.cutout, now); await is.put(c); g.cutoutImageId = c.id; } else g.cutoutImageId = null;
  }
  if (images?.thumb) { const t = img('thumbnail', images.thumb, now); await is.put(t); remove.push(old.thumbImageId); g.thumbImageId = t.id; }
  for (const r of remove) await is.delete(r);
  await gs.put(g);
  try { await tx.done; } catch (e) { throw quotaError(e); }
  return g;
}

export async function deleteGarment(id: string) {
  const db = await getDB();
  const tx = db.transaction(['garments', 'images'], 'readwrite');
  const g = await tx.objectStore('garments').get(id);
  if (g) {
    for (const i of [g.originalImageId, g.cutoutImageId, g.thumbImageId]) if (i) await tx.objectStore('images').delete(i);
    await tx.objectStore('garments').delete(id);
  }
  await tx.done;
}

export async function toggleFavorite(id: string): Promise<0 | 1> {
  const g = await getGarment(id);
  if (!g) throw new Error('找不到這件衣服');
  const fav = g.favorite ? 0 : 1;
  await updateGarment(id, { favorite: fav });
  return fav;
}

export async function getImageBlob(id: string): Promise<Blob | undefined> {
  return (await (await getDB()).get('images', id))?.blob;
}
