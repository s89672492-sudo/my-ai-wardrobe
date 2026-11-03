/** 穿搭收藏（多件組合）。 */
import { getDB } from './db';
import { uid } from './image';
import type { Outfit } from './types';

export async function saveOutfit(o: Omit<Outfit, 'id' | 'createdAt' | 'favorite'> & { favorite?: 0 | 1 }): Promise<Outfit> {
  const rec: Outfit = { ...o, id: uid(), createdAt: Date.now(), favorite: o.favorite ?? 1 };
  await (await getDB()).put('outfits', rec);
  return rec;
}
export async function listOutfits(): Promise<Outfit[]> {
  return (await (await getDB()).getAllFromIndex('outfits', 'byCreatedAt')).reverse();
}
export async function getOutfit(id: string) { return (await getDB()).get('outfits', id); }
export async function deleteOutfit(id: string) { await (await getDB()).delete('outfits', id); }
export async function renameOutfit(id: string, name: string) {
  const db = await getDB();
  const o = await db.get('outfits', id);
  if (o) await db.put('outfits', { ...o, name });
}
