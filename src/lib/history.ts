/** 歷史紀錄（試穿、推薦）。 */
import { getDB } from './db';
import { uid } from './image';
import type { HistoryEntry } from './types';

export async function addHistory(type: HistoryEntry['type'], refId: string) {
  await (await getDB()).put('history', { id: uid(), type, refId, createdAt: Date.now() });
}
export async function listHistory(type?: HistoryEntry['type'], limit = 50): Promise<HistoryEntry[]> {
  const all = (await (await getDB()).getAllFromIndex('history', 'byCreatedAt')).reverse();
  return (type ? all.filter((h) => h.type === type) : all).slice(0, limit);
}
