/**
 * 本機儲存空間管理：用量統計、重複與孤兒圖片檢查、圖片壓縮、選擇性清除。
 * 全部只在 IndexedDB 內運作，不連線任何伺服器。
 */
import { getDB } from './db';
import type { ImageKind, StoredImage } from './types';

export const KIND_ZH: Record<ImageKind, string> = {
  'garment-original': '衣服原圖', 'garment-cutout': '衣服去背圖', person: '全身照', 'person-mask': '人體輪廓', 'person-parse': '人體部位圖', tryon: '試穿圖', thumbnail: '縮圖', avatar: '自訂頭像',
};

export interface StorageReport {
  byKind: Record<ImageKind, { count: number; bytes: number }>;
  totalBytes: number;
  records: { garments: number; persons: number; tryons: number; outfits: number; history: number };
}

export async function storageReport(): Promise<StorageReport> {
  const db = await getDB();
  const byKind = Object.fromEntries(Object.keys(KIND_ZH).map((k) => [k, { count: 0, bytes: 0 }])) as StorageReport['byKind'];
  let totalBytes = 0;
  let cur = await db.transaction('images').store.openCursor();
  while (cur) {
    const v = cur.value;
    const k = byKind[v.kind] ?? (byKind[v.kind] = { count: 0, bytes: 0 });
    k.count++; k.bytes += v.blob.size; totalBytes += v.blob.size;
    cur = await cur.continue();
  }
  const [garments, persons, tryons, outfits, history] = await Promise.all((['garments', 'persons', 'tryons', 'outfits', 'history'] as const).map((s) => db.count(s)));
  return { byKind, totalBytes, records: { garments: garments!, persons: persons!, tryons: tryons!, outfits: outfits!, history: history! } };
}

/** 所有被資料引用到的圖片 ID */
async function referencedImageIds(): Promise<Set<string>> {
  const db = await getDB();
  const ids = new Set<string>();
  for (const g of await db.getAll('garments')) [g.originalImageId, g.cutoutImageId, g.thumbImageId].forEach((i) => i && ids.add(i));
  for (const p of await db.getAll('persons')) [p.imageId, p.thumbImageId, p.maskImageId, p.parseImageId].forEach((i) => i && ids.add(i));
  for (const t of await db.getAll('tryons')) [t.imageId, t.thumbImageId].forEach((i) => i && ids.add(i));
  const c = (await db.get('settings', 'app'))?.couple;
  [c?.herAvatarId, c?.himAvatarId].forEach((i) => i && ids.add(i));
  return ids;
}

export interface DuplicateReport {
  /** 沒有任何資料引用的圖片（例如中途失敗殘留） */
  orphans: { id: string; kind: ImageKind; bytes: number }[];
  /** 原始照片內容相同的衣服群組 */
  garmentGroups: { hash: string; garments: { id: string; name: string; createdAt: number }[] }[];
  /** 內容相同的全身照 */
  personGroups: { hash: string; persons: { id: string; name: string }[] }[];
  /** 收藏中衣服組合完全相同的穿搭 */
  outfitGroups: { ids: string[]; names: string[] }[];
}

export async function scanDuplicates(): Promise<DuplicateReport> {
  const db = await getDB();
  const refs = await referencedImageIds();
  const images = await db.getAll('images');
  const byId = new Map(images.map((i) => [i.id, i]));
  const orphans = images.filter((i) => !refs.has(i.id)).map((i) => ({ id: i.id, kind: i.kind, bytes: i.blob.size }));

  const group = <T,>(items: T[], key: (t: T) => string | null) => {
    const m = new Map<string, T[]>();
    for (const t of items) { const k = key(t); if (!k) continue; m.set(k, [...(m.get(k) ?? []), t]); }
    return [...m.entries()].filter(([, v]) => v.length > 1);
  };
  const garments = await db.getAll('garments');
  const garmentGroups = group(garments, (g) => byId.get(g.originalImageId)?.hash || null)
    .map(([hash, gs]) => ({ hash, garments: gs.map((g) => ({ id: g.id, name: g.name, createdAt: g.createdAt })) }));
  const persons = await db.getAll('persons');
  const personGroups = group(persons, (p) => byId.get(p.imageId)?.hash || null).map(([hash, ps]) => ({ hash, persons: ps.map((p) => ({ id: p.id, name: p.name })) }));
  const outfits = await db.getAll('outfits');
  const outfitGroups = group(outfits, (o) => [...o.garmentIds].sort().join('+')).map(([, os]) => ({ ids: os.map((o) => o.id), names: os.map((o) => o.name) }));
  return { orphans, garmentGroups, personGroups, outfitGroups };
}

export async function deleteImages(ids: string[]) {
  const db = await getDB();
  const tx = db.transaction('images', 'readwrite');
  for (const id of ids) await tx.store.delete(id);
  await tx.done;
}

/** 選擇性清除（不影響衣服、全身照） */
export async function clearTryOns() {
  const db = await getDB();
  const tx = db.transaction(['tryons', 'images', 'history'], 'readwrite');
  for (const t of await tx.objectStore('tryons').getAll()) { await tx.objectStore('images').delete(t.imageId); await tx.objectStore('images').delete(t.thumbImageId); }
  await tx.objectStore('tryons').clear();
  for (const h of await tx.objectStore('history').getAll()) if (h.type === 'tryon') await tx.objectStore('history').delete(h.id);
  await tx.done;
}
export async function clearRecommendHistory() {
  const db = await getDB();
  const tx = db.transaction('history', 'readwrite');
  for (const h of await tx.store.getAll()) if (h.type === 'recommend') await tx.store.delete(h.id);
  await tx.done;
}

export interface OptimizeResult { processed: number; savedBytes: number; skipped: number }

/**
 * 重新壓縮 JPEG 類圖片（衣服原圖、全身照、試穿圖）：超過長邊上限的縮小、品質降到 profile 設定。
 * 只有新檔案比較小時才取代；PNG（去背圖、輪廓）保留透明度不處理。
 */
export async function optimizeImages(maxSide: number, quality: number, onProgress?: (s: string) => void): Promise<OptimizeResult> {
  const db = await getDB();
  const targets = (await db.getAll('images')).filter((i) => (i.kind === 'garment-original' || i.kind === 'person' || i.kind === 'tryon') && i.blob.type === 'image/jpeg');
  let processed = 0, savedBytes = 0, skipped = 0;
  for (let n = 0; n < targets.length; n++) {
    const img = targets[n]!;
    onProgress?.(`壓縮圖片 ${n + 1}/${targets.length}`);
    // 全身照縮小會讓人體關鍵點座標失準，只降品質不縮尺寸
    const limit = img.kind === 'person' ? Infinity : maxSide;
    const bmp = await createImageBitmap(img.blob);
    const s = Math.min(1, limit / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= img.blob.size * 0.95) { skipped++; continue; }
    // 衣服原圖若縮小，去背、試穿用的是去背圖，不受影響
    const next: StoredImage = { ...img, blob, width: c.width, height: c.height };
    await db.put('images', next);
    savedBytes += img.blob.size - blob.size;
    processed++;
  }
  return { processed, savedBytes, skipped };
}

export const fmtBytes = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
