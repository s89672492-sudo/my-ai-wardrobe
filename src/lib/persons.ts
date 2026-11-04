/** 全身照 CRUD（照片、遮罩、縮圖與分析結果）。 */
import type { BodyAnalysis } from '../ai/body';
import { getDB } from './db';
import { uid } from './image';
import type { PersonPhoto, StoredImage } from './types';

type ImgIn = { blob: Blob; width: number; height: number; hash?: string };
const mk = (kind: StoredImage['kind'], d: ImgIn, now: number): StoredImage => ({ id: uid(), kind, blob: d.blob, width: d.width, height: d.height, hash: d.hash ?? '', createdAt: now });

export async function listPersons(): Promise<PersonPhoto[]> {
  return (await (await getDB()).getAllFromIndex('persons', 'byCreatedAt')).reverse();
}
export async function getPerson(id: string) { return (await getDB()).get('persons', id); }

export async function savePerson(input: { id?: string; name: string; photo?: ImgIn; mask?: ImgIn | null; thumb?: ImgIn; parse?: ImgIn | null; analysis: BodyAnalysis | null; corrected: boolean }): Promise<PersonPhoto> {
  const db = await getDB();
  const tx = db.transaction(['persons', 'images'], 'readwrite');
  const ps = tx.objectStore('persons'), is = tx.objectStore('images');
  const now = Date.now();
  const old = input.id ? await ps.get(input.id) : undefined;
  const remove: string[] = [];
  let imageId = old?.imageId, thumbImageId = old?.thumbImageId, maskImageId = old?.maskImageId ?? null, parseImageId = old?.parseImageId ?? null;
  if (input.photo) { const i = mk('person', input.photo, now); await is.put(i); if (imageId) remove.push(imageId); imageId = i.id; }
  if (input.thumb) { const i = mk('thumbnail', input.thumb, now); await is.put(i); if (thumbImageId) remove.push(thumbImageId); thumbImageId = i.id; }
  if (input.mask !== undefined) {
    if (maskImageId) remove.push(maskImageId);
    maskImageId = null;
    if (input.mask) { const i = mk('person-mask', input.mask, now); await is.put(i); maskImageId = i.id; }
  }
  if (input.parse !== undefined) {
    if (parseImageId) remove.push(parseImageId);
    parseImageId = null;
    if (input.parse) { const i = mk('person-parse', input.parse, now); await is.put(i); parseImageId = i.id; }
  }
  if (!imageId || !thumbImageId) throw new Error('缺少照片');
  const p: PersonPhoto = { id: old?.id ?? uid(), imageId, thumbImageId, maskImageId, parseImageId, name: input.name, analysis: input.analysis, corrected: input.corrected, createdAt: old?.createdAt ?? now, updatedAt: now };
  await ps.put(p);
  for (const r of remove) await is.delete(r);
  try { await tx.done; } catch (e) {
    throw (e as DOMException)?.name === 'QuotaExceededError' ? new Error('手機儲存空間不足，無法儲存照片') : e;
  }
  return p;
}

export async function deletePerson(id: string) {
  const db = await getDB();
  const tx = db.transaction(['persons', 'images'], 'readwrite');
  const p = await tx.objectStore('persons').get(id);
  if (p) {
    for (const i of [p.imageId, p.thumbImageId, p.maskImageId, p.parseImageId]) if (i) await tx.objectStore('images').delete(i);
    await tx.objectStore('persons').delete(id);
  }
  await tx.done;
}
