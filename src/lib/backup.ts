/**
 * 完整備份：所有資料表 + 圖片打包成一個 .zip，只存在使用者自己選的位置。
 * 匯入採「合併」：已存在的資料（相同 ID）會略過，不覆蓋。
 */
import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import { getDB, DB_VERSION } from './db';
import type { AppSettings, StoredImage } from './types';

const FORMAT = 'my-ai-wardrobe-backup';
const DATA_STORES = ['garments', 'persons', 'tryons', 'outfits', 'history'] as const;

interface Manifest {
  format: typeof FORMAT;
  formatVersion: 1;
  dbVersion: number;
  exportedAt: string;
  data: Record<(typeof DATA_STORES)[number], unknown[]>;
  images: (Omit<StoredImage, 'blob'> & { file: string; type: string })[];
  settings?: AppSettings;
}

const extOf = (t: string) => (t === 'image/png' ? 'png' : t === 'image/webp' ? 'webp' : 'jpg');

export async function exportBackup(onProgress?: (s: string) => void): Promise<File> {
  const db = await getDB();
  const data = {} as Manifest['data'];
  for (const s of DATA_STORES) data[s] = await db.getAll(s);
  const images = await db.getAll('images');
  const files: Zippable = {};
  const meta: Manifest['images'] = [];
  for (let i = 0; i < images.length; i++) {
    const im = images[i]!;
    onProgress?.(`打包圖片 ${i + 1}/${images.length}`);
    const file = `images/${im.id}.${extOf(im.blob.type)}`;
    files[file] = [new Uint8Array(await im.blob.arrayBuffer()), { level: 0 }]; // 圖片已壓縮，不再壓縮
    const { blob, ...rest } = im;
    meta.push({ ...rest, file, type: blob.type });
  }
  const manifest: Manifest = { format: FORMAT, formatVersion: 1, dbVersion: DB_VERSION, exportedAt: new Date().toISOString(), data, images: meta, settings: await db.get('settings', 'app') };
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  onProgress?.('產生備份檔');
  const zip = zipSync(files);
  const d = new Date();
  const name = `my-ai-wardrobe-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.zip`;
  return new File([zip as Uint8Array<ArrayBuffer>], name, { type: 'application/zip' });
}

/** iPhone 用分享面板（可存到「檔案」），其他瀏覽器直接下載。回傳 false 表示使用者取消 */
export async function saveFile(file: File): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return true; } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false; // 使用者自己關掉分享面板
      // 其他錯誤（例如不允許分享）→ 改用下載
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return true;
}

export interface ImportReport { added: Record<string, number>; skipped: number; images: number; missingImages: number; settingsRestored: boolean }

/** mode: merge＝保留現有資料，只加入新的；replace＝先清空再還原（含設定） */
export async function importBackup(file: File, onProgress?: (s: string) => void, mode: 'merge' | 'replace' = 'merge'): Promise<ImportReport> {
  onProgress?.('讀取備份檔');
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(new Uint8Array(await file.arrayBuffer())); } catch { throw new Error('這不是有效的備份檔（無法解壓縮）'); }
  const raw = entries['manifest.json'];
  if (!raw) throw new Error('備份檔缺少 manifest.json，可能不是本 App 的備份');
  let m: Manifest;
  try { m = JSON.parse(strFromU8(raw)) as Manifest; } catch { throw new Error('備份檔內容損壞'); }
  if (m.format !== FORMAT) throw new Error('這不是 AI 衣櫥的備份檔');
  if (m.formatVersion > 1) throw new Error('備份檔版本較新，請先更新 App');
  if (!Array.isArray(m.images) || typeof m.data !== 'object' || !m.data) throw new Error('備份檔內容不完整');
  for (const s of DATA_STORES) if (m.data[s] !== undefined && !Array.isArray(m.data[s])) throw new Error('備份檔內容格式錯誤');

  const db = await getDB();
  const report: ImportReport = { added: {}, skipped: 0, images: 0, missingImages: 0, settingsRestored: false };
  if (mode === 'replace') {
    onProgress?.('清空現有資料');
    const tx = db.transaction(['images', ...DATA_STORES], 'readwrite');
    await Promise.all([tx.objectStore('images').clear(), ...DATA_STORES.map((s) => tx.objectStore(s).clear()), tx.done]);
  }
  const existingImages = new Set(await db.getAllKeys('images'));
  const blobs: StoredImage[] = [];
  for (const im of m.images) {
    if (existingImages.has(im.id)) continue;
    const bytes = entries[im.file];
    if (!bytes) { report.missingImages++; continue; }
    const { file: _f, type, ...rest } = im;
    blobs.push({ ...rest, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type }) });
  }
  onProgress?.('寫入資料');
  const tx = db.transaction(['images', ...DATA_STORES], 'readwrite');
  for (const b of blobs) { await tx.objectStore('images').put(b); report.images++; }
  for (const s of DATA_STORES) {
    const store = tx.objectStore(s);
    let n = 0;
    for (const rec of m.data[s] ?? []) {
      const id = (rec as { id?: string }).id;
      if (!id || (await store.getKey(id))) { report.skipped++; continue; }
      await store.put(rec as never);
      n++;
    }
    report.added[s] = n;
  }
  try { await tx.done; } catch (e) {
    throw (e as DOMException)?.name === 'QuotaExceededError' ? new Error('手機儲存空間不足，無法完成匯入') : e;
  }
  if (mode === 'replace' && m.settings) {
    const t = Date.parse(m.exportedAt);
    await db.put('settings', { ...m.settings, lastBackupAt: Math.max(m.settings.lastBackupAt ?? 0, Number.isFinite(t) ? t : 0) || undefined }, 'app');
    report.settingsRestored = true;
  }
  return report;
}
