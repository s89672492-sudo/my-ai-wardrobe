/**
 * IndexedDB（所有資料只存在這支手機）。照片以 Blob 存入 images，
 * 絕不使用 localStorage 存照片。
 */
import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type AppSettings, type Garment, type HistoryEntry, type Outfit, type PersonPhoto, type StoredImage, type TryOnResult } from './types';

export const DB_NAME = 'my-ai-wardrobe';
export const DB_VERSION = 1;

export interface WardrobeDB extends DBSchema {
  garments: { key: string; value: Garment; indexes: { byCategory: string; byCreatedAt: number; byFavorite: number } };
  images: { key: string; value: StoredImage; indexes: { byHash: string; byKind: string } };
  persons: { key: string; value: PersonPhoto; indexes: { byCreatedAt: number } };
  tryons: { key: string; value: TryOnResult; indexes: { byCreatedAt: number } };
  outfits: { key: string; value: Outfit; indexes: { byCreatedAt: number; byFavorite: number } };
  history: { key: string; value: HistoryEntry; indexes: { byCreatedAt: number } };
  settings: { key: string; value: AppSettings };
}

let dbPromise: Promise<IDBPDatabase<WardrobeDB>> | null = null;

export function getDB() {
  dbPromise ??= openDB<WardrobeDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // 依版本逐步遷移；未來新增版本時在下方加 if (oldVersion < 2) {...}
      if (oldVersion < 1) {
        const g = db.createObjectStore('garments', { keyPath: 'id' });
        g.createIndex('byCategory', 'category');
        g.createIndex('byCreatedAt', 'createdAt');
        g.createIndex('byFavorite', 'favorite');
        const i = db.createObjectStore('images', { keyPath: 'id' });
        i.createIndex('byHash', 'hash');
        i.createIndex('byKind', 'kind');
        db.createObjectStore('persons', { keyPath: 'id' }).createIndex('byCreatedAt', 'createdAt');
        db.createObjectStore('tryons', { keyPath: 'id' }).createIndex('byCreatedAt', 'createdAt');
        const o = db.createObjectStore('outfits', { keyPath: 'id' });
        o.createIndex('byCreatedAt', 'createdAt');
        o.createIndex('byFavorite', 'favorite');
        db.createObjectStore('history', { keyPath: 'id' }).createIndex('byCreatedAt', 'createdAt');
        db.createObjectStore('settings');
      }
    },
    blocked() {
      alert('請關閉本 App 的其他分頁後重新整理，以完成資料庫更新。');
    },
    terminated() { dbPromise = null; },
  }).catch((e: unknown) => {
    dbPromise = null;
    throw new Error(`無法開啟本機資料庫：${e instanceof Error ? e.message : String(e)}。若使用私密瀏覽，請改用一般模式。`);
  });
  return dbPromise;
}

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDB();
  return { ...DEFAULT_SETTINGS, ...(await db.get('settings', 'app')) };
}

export async function saveSettings(s: AppSettings) {
  const db = await getDB();
  await db.put('settings', s, 'app');
}

export async function countAll() {
  const db = await getDB();
  const [garments, outfits, tryons, persons] = await Promise.all([db.count('garments'), db.count('outfits'), db.count('tryons'), db.count('persons')]);
  return { garments, outfits, tryons, persons };
}

export async function clearAllData() {
  const db = await getDB();
  db.close();
  dbPromise = null;
  await deleteDB(DB_NAME);
}
