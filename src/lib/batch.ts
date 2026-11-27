/**
 * 批次處理衣服：一次新增多件（最多 200 張）或重新處理舊衣服。
 * - 照片先存進這支手機的 IndexedDB 待處理清單，App 被關掉也能「從第 N 張繼續」
 * - 每件做完立刻存到衣櫥並在清單標記完成，繼續時不會重做、也不會重複收費
 * - 手機上的 AI（去背、分類）一次只跑一個；Gemini 可同時處理幾件以加快速度
 */
import { classifyGarment } from '../ai/garment-classify';
import { ensureCutoutModel, runCutout } from '../ai/cutout';
import type { Accelerator } from '../ai/protocol';
import { COST_NT, geminiJudge, geminiMask, geminiRedraw, whiteToAlpha } from './cloud-garment';
import { getDB } from './db';
import { createGarment, findDuplicate, getGarment, getImageBlob, updateGarment, type GarmentImages, type GarmentMeta } from './garments';
import { alphaBBox, canvasToBlob, ctx2d, decodeImageFile, guessColor, imageProfile, LIMITS, makeCanvas, makeThumbnail, sha256, uid } from './image';
import type { BatchJob, BatchJobItem } from './batch-types';
import { CATEGORIES, type CategoryId, type CutoutMethod, type Garment, type JudgeMethod } from './types';

export type { BatchJob, BatchJobItem };
export const MAX_BATCH = 200;

/* ---------- 費用預估 ---------- */

export function costPerItem(o: { kind: BatchJob['kind']; cutout: CutoutMethod; judge: JudgeMethod; redoCutout: boolean; redoJudge: boolean }): number {
  const doCut = o.kind === 'add' || o.redoCutout, doJudge = o.kind === 'add' || o.redoJudge;
  return (doCut ? (o.cutout === 'gemini-redraw' ? COST_NT.redraw : o.cutout === 'gemini-mask' ? COST_NT.mask : 0) : 0)
    + (doJudge && o.judge === 'gemini' ? COST_NT.judge : 0);
}
export const formatNT = (n: number) => (n === 0 ? 'NT$0（免費）' : `約 NT$${n < 10 ? n.toFixed(1) : Math.round(n)}`);

/* ---------- 工作清單（IndexedDB） ---------- */

export async function getJob(): Promise<{ job: BatchJob; items: BatchJobItem[] } | null> {
  const db = await getDB();
  const job = await db.get('jobs', 'current');
  if (!job) return null;
  const items = (await db.getAllFromIndex('jobItems', 'byJob', 'current')).sort((a, b) => a.index - b.index);
  return { job, items };
}

/** 還沒處理完的工作數量（衣櫥頁提醒用） */
export async function pendingCount(): Promise<number> {
  const j = await getJob();
  return j && j.job.started ? j.items.filter((i) => i.status === 'pending').length : 0;
}

export async function clearJob() {
  const db = await getDB();
  const tx = db.transaction(['jobs', 'jobItems'], 'readwrite');
  await Promise.all([tx.objectStore('jobs').clear(), tx.objectStore('jobItems').clear(), tx.done]);
}

export async function updateJob(patch: Partial<BatchJob>) {
  const db = await getDB();
  const job = await db.get('jobs', 'current');
  if (job) await db.put('jobs', { ...job, ...patch });
}

/** 把失敗的項目改回待處理，之後按繼續會再試一次 */
export async function retryFailed() {
  const db = await getDB();
  const tx = db.transaction('jobItems', 'readwrite');
  for (const it of await tx.store.index('byJob').getAll('current')) if (it.status === 'error') await tx.store.put({ ...it, status: 'pending', message: undefined });
  await tx.done;
}

/**
 * 一次新增多件：先把選的照片轉正、縮到儲存尺寸後存進待處理清單（同時檢查重複）。
 * 存好後才開始處理，所以中途被關掉也不會遺失。
 */
export async function createAddJob(files: File[], o: { cutout: CutoutMethod; judge: JudgeMethod }, onProgress: (done: number) => void): Promise<void> {
  await clearJob();
  const db = await getDB();
  const seen = new Set<string>();
  let index = 0;
  for (const file of files.slice(0, MAX_BATCH)) {
    const item: BatchJobItem = { id: uid(), jobId: 'current', index: index++, status: 'pending' };
    try {
      const hash = await sha256(file);
      const dupe = seen.has(hash) ? null : await findDuplicate(hash);
      if (seen.has(hash)) { item.status = 'duplicate'; item.message = '這批照片裡重複選到同一張'; }
      else if (dupe) { item.status = 'duplicate'; item.resultId = dupe.id; item.message = `已經在衣櫥裡（${dupe.name}）`; }
      else {
        const bmp = await decodeImageFile(file, imageProfile().originalMaxSide);
        const c = makeCanvas(bmp.width, bmp.height);
        ctx2d(c).drawImage(bmp, 0, 0);
        bmp.close();
        item.photo = await canvasToBlob(c, 'image/jpeg', imageProfile().jpegQ);
        item.hash = hash;
        c.width = c.height = 0;
      }
      seen.add(hash);
    } catch (e) { item.status = 'error'; item.message = (e as Error).message; }
    try { await db.put('jobItems', item); } catch (e) {
      await clearJob();
      throw (e as DOMException).name === 'QuotaExceededError' ? new Error('手機儲存空間不足，請少選一些照片或先釋放空間。') : e;
    }
    onProgress(index);
  }
  await db.put('jobs', { id: 'current', kind: 'add', createdAt: Date.now(), started: true, cutout: o.cutout, judge: o.judge, redoCutout: true, redoJudge: true, total: index });
}

/** 重新處理勾選的舊衣服（之後在批次頁選要重做什麼、確認費用才開始） */
export async function createRedoJob(garmentIds: string[], o: { cutout: CutoutMethod; judge: JudgeMethod }) {
  await clearJob();
  const db = await getDB();
  const tx = db.transaction(['jobs', 'jobItems'], 'readwrite');
  garmentIds.forEach((garmentId, index) => void tx.objectStore('jobItems').put({ id: uid(), jobId: 'current', index, garmentId, status: 'pending' }));
  void tx.objectStore('jobs').put({ id: 'current', kind: 'redo', createdAt: Date.now(), started: false, cutout: o.cutout, judge: o.judge, redoCutout: true, redoJudge: true, total: garmentIds.length });
  await tx.done;
}

/* ---------- 單件處理 ---------- */

/** 手機上的 AI 一次只跑一個（模型共用、控制記憶體） */
let localChain: Promise<unknown> = Promise.resolve();
function local<T>(fn: () => Promise<T>): Promise<T> {
  const p = localChain.then(fn, fn);
  localChain = p.catch(() => {});
  return p;
}

/** 金鑰或權限問題：後面每件都會失敗，直接停下整批 */
class FatalError extends Error {}
const isFatal = (e: unknown) => [400, 401, 403, 404].includes((e as { status?: number }).status ?? 0);

/** Gemini 太忙（429）或暫時錯誤時等一下再試 */
async function cloud<T>(fn: () => Promise<T>, signal: AbortSignal, onStage: (s: string) => void): Promise<T> {
  const waits = [4000, 12000, 30000];
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (signal.aborted || (e as Error).message === '已取消') throw new Error('已取消');
      if (isFatal(e)) throw new FatalError((e as Error).message);
      const status = (e as { status?: number }).status ?? 0;
      const retry = status === 429 || status >= 500 || /無法連線/.test((e as Error).message);
      if (!retry || i >= waits.length) throw e;
      onStage(`Google 忙碌中，${waits[i]! / 1000} 秒後重試`);
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}

interface Ctx { accelerator: Accelerator; signal: AbortSignal; onStage: (s: string) => void }

function toCanvas(src: CanvasImageSource & { width: number; height: number }, maxSide: number) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = makeCanvas(Math.round(src.width * s), Math.round(src.height * s));
  const x = ctx2d(c); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
async function blobToCanvas(b: Blob, maxSide: number) {
  const bmp = await createImageBitmap(b);
  const c = toCanvas(bmp, maxSide); bmp.close();
  return c;
}
const pixels = (c: HTMLCanvasElement) => ctx2d(c, { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;

/** 依透明度裁到衣服範圍；衣服太小（多半沒抓到）回傳 null */
function cropToAlpha(full: HTMLCanvasElement, minArea: number): { canvas: HTMLCanvasElement; data: Uint8ClampedArray } | null {
  const d = pixels(full);
  const bb = alphaBBox(d, full.width, full.height);
  if (!bb || bb.w * bb.h <= full.width * full.height * minArea) return null;
  const pad = Math.round(Math.max(bb.w, bb.h) * 0.02);
  const sx = Math.max(0, bb.x - pad), sy = Math.max(0, bb.y - pad);
  const out = makeCanvas(Math.min(full.width - sx, bb.w + 2 * pad), Math.min(full.height - sy, bb.h + 2 * pad));
  ctx2d(out).drawImage(full, sx, sy, out.width, out.height, 0, 0, out.width, out.height);
  return { canvas: out, data: pixels(out) };
}

/** 手機 MagicTouch：以照片中心為衣服 */
async function localCutout(work: HTMLCanvasElement, ctx: Ctx) {
  return local(async () => {
    if (ctx.signal.aborted) throw new Error('已取消');
    await ensureCutoutModel(ctx.accelerator, ctx.onStage);
    const m = await runCutout(await createImageBitmap(work), [{ x: 0.5, y: 0.5 }], ctx.onStage);
    const full = makeCanvas(work.width, work.height), fx = ctx2d(full, { willReadFrequently: true });
    fx.drawImage(work, 0, 0);
    fx.globalCompositeOperation = 'destination-in';
    fx.drawImage(m, 0, 0, work.width, work.height);
    m.close();
    return cropToAlpha(full, 0.04);
  });
}

/** 依去背方式去背；失敗回傳 null（保留原圖，之後可在衣服頁重新去背） */
async function cutoutWith(method: CutoutMethod, work: HTMLCanvasElement, ctx: Ctx): Promise<{ canvas: HTMLCanvasElement; data: Uint8ClampedArray } | null> {
  if (method === 'gemini-mask') {
    ctx.onStage('Gemini 標出衣服範圍');
    const mask = await cloud(() => geminiMask(work, ctx.signal), ctx.signal, ctx.onStage);
    if (!mask) return null;
    const full = makeCanvas(work.width, work.height), fx = ctx2d(full, { willReadFrequently: true });
    fx.drawImage(work, 0, 0);
    fx.globalCompositeOperation = 'destination-in';
    fx.drawImage(mask, 0, 0);
    return cropToAlpha(full, 0.02);
  }
  if (method === 'gemini-redraw') {
    ctx.onStage('Gemini 重畫在白底（約 10–20 秒）');
    const img = await cloud(() => geminiRedraw(work, ctx.signal), ctx.signal, ctx.onStage);
    const c = await blobToCanvas(img, LIMITS.cutoutMaxSide);
    ctx.onStage('去掉白色背景');
    const { ratio } = whiteToAlpha(c);
    // 背景不是白色（Gemini 沒照做）就改用手機去背這張重畫的圖
    if (ratio > 0.97 || ratio < 0.03) return localCutout(await blobToCanvas(img, LIMITS.cutoutMaxSide), ctx);
    return cropToAlpha(c, 0.02);
  }
  ctx.onStage('AI 去背');
  return localCutout(work, ctx);
}

interface Judged { category: CategoryId; color: string; seasons?: Garment['seasons']; styles?: Garment['styles']; name?: string; by: 'gemini' | 'local' | 'none' }

async function judgeWith(method: JudgeMethod, cut: { canvas: HTMLCanvasElement; data: Uint8ClampedArray } | null, whole: HTMLCanvasElement, ctx: Ctx): Promise<Judged> {
  if (method === 'gemini') {
    ctx.onStage('Gemini 判斷種類、顏色、季節');
    const j = await cloud(() => geminiJudge(cut?.canvas ?? whole, ctx.signal), ctx.signal, ctx.onStage);
    return { ...j, color: j.color || (cut ? guessColor(cut.data) : ''), by: 'gemini' };
  }
  ctx.onStage('判斷種類與顏色');
  if (!cut) return { category: 'tshirt', color: '', by: 'none' };
  const sug = await local(() => classifyGarment(cut.canvas));
  const ok = !!sug && sug.confidence >= 0.08;
  return { category: ok ? sug.category : 'tshirt', color: guessColor(cut.data), by: ok ? 'local' : 'none' };
}

const labelOf = (c: CategoryId) => CATEGORIES.find((x) => x.id === c)?.label ?? '';

async function images(cut: { canvas: HTMLCanvasElement } | null, fallback: HTMLCanvasElement): Promise<Pick<GarmentImages, 'cutout' | 'thumb'>> {
  const out = cut?.canvas ?? fallback;
  return {
    cutout: cut ? { blob: await canvasToBlob(cut.canvas, 'image/png'), width: cut.canvas.width, height: cut.canvas.height } : null,
    thumb: { blob: await makeThumbnail(out), width: LIMITS.thumbSide, height: Math.round(LIMITS.thumbSide * 4 / 3) },
  };
}

async function processAdd(it: BatchJobItem, job: BatchJob, ctx: Ctx): Promise<Partial<BatchJobItem>> {
  if (!it.photo || !it.hash) return { status: 'error', message: '照片遺失，請重新選擇' };
  const dupe = await findDuplicate(it.hash);
  if (dupe) return { status: 'duplicate', resultId: dupe.id, message: `已經在衣櫥裡（${dupe.name}）` };
  ctx.onStage('讀取照片');
  const bmp = await createImageBitmap(it.photo);
  const ow = bmp.width, oh = bmp.height;
  const work = toCanvas(bmp, LIMITS.cutoutMaxSide); bmp.close();
  const cut = await cutoutWith(job.cutout, work, ctx);
  const j = await judgeWith(job.judge, cut, work, ctx);
  ctx.onStage('儲存');
  const meta: GarmentMeta = { name: j.name || `${j.color}${labelOf(j.category)}`, category: j.category, color: j.color, brand: '', size: '', seasons: j.seasons ?? [], notes: '', favorite: 0, styles: j.styles ?? [] };
  const g = await createGarment(meta, { original: { blob: it.photo, width: ow, height: oh, hash: it.hash }, ...(await images(cut, work)) });
  return { status: 'added', resultId: g.id, judged: j.by, cutoutOk: !!cut, photo: undefined };
}

async function processRedo(it: BatchJobItem, job: BatchJob, ctx: Ctx): Promise<Partial<BatchJobItem>> {
  const g = it.garmentId ? await getGarment(it.garmentId) : undefined;
  if (!g) return { status: 'error', message: '這件衣服已經被刪除' };
  ctx.onStage('讀取照片');
  const orig = await getImageBlob(g.originalImageId);
  if (!orig) return { status: 'error', message: '找不到原始照片' };
  const work = await blobToCanvas(orig, LIMITS.cutoutMaxSide);
  let cut: { canvas: HTMLCanvasElement; data: Uint8ClampedArray } | null = null;
  const imgs: Partial<GarmentImages> = {};
  let cutoutOk: boolean | undefined;
  if (job.redoCutout) {
    cut = await cutoutWith(job.cutout, work, ctx);
    cutoutOk = !!cut;
    if (cut) Object.assign(imgs, await images(cut, work));
  } else if (g.cutoutImageId) {
    const b = await getImageBlob(g.cutoutImageId);
    if (b) { const c = await blobToCanvas(b, LIMITS.cutoutMaxSide); cut = { canvas: c, data: pixels(c) }; }
  }
  const meta: Partial<GarmentMeta> = {};
  let judged: BatchJobItem['judged'];
  if (job.redoJudge) {
    const j = await judgeWith(job.judge, cut, work, ctx);
    judged = j.by;
    if (j.by !== 'none') {
      // 手機判斷只更新種類和顏色；名稱若是自動取的（顏色＋種類）才跟著改
      const autoName = !g.name || g.name === `${g.color}${labelOf(g.category)}`;
      meta.category = j.category;
      if (j.color) meta.color = j.color;
      if (j.by === 'gemini') { meta.seasons = j.seasons ?? []; meta.styles = j.styles ?? []; if (j.name) meta.name = j.name; }
      else if (autoName) meta.name = `${j.color || g.color}${labelOf(j.category)}`;
    }
  }
  ctx.onStage('儲存');
  await updateGarment(g.id, meta, imgs);
  return { status: 'updated', resultId: g.id, judged, cutoutOk };
}

/* ---------- 執行整批 ---------- */

export interface RunHooks {
  accelerator: Accelerator;
  signal: AbortSignal;
  onStage: (itemId: string, stage: string) => void;
  onItem: (item: BatchJobItem) => void;
}

/** 處理所有待處理的項目。被停止時已完成的會保留；金鑰等問題會停下並丟出錯誤 */
export async function runJob(h: RunHooks): Promise<void> {
  const cur = await getJob();
  if (!cur) return;
  const { job } = cur;
  const queue = cur.items.filter((i) => i.status === 'pending');
  const usesCloud = job.judge === 'gemini' || ((job.kind === 'add' || job.redoCutout) && job.cutout !== 'local');
  const workers = usesCloud ? 3 : 1;
  const db = await getDB();
  let fatal: Error | null = null;
  async function worker() {
    for (;;) {
      if (h.signal.aborted || fatal) return;
      const it = queue.shift();
      if (!it) return;
      const ctx: Ctx = { accelerator: h.accelerator, signal: h.signal, onStage: (s) => h.onStage(it.id, s) };
      let patch: Partial<BatchJobItem>;
      try {
        patch = job.kind === 'add' ? await processAdd(it, job, ctx) : await processRedo(it, job, ctx);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === '已取消' || h.signal.aborted) return; // 停止：這件維持待處理，下次繼續
        if (e instanceof FatalError) { fatal = e; return; }
        patch = { status: 'error', message: msg };
      }
      const next = { ...it, ...patch };
      if ('photo' in patch && !patch.photo) delete next.photo;
      await db.put('jobItems', next);
      h.onItem(next);
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  if (fatal) throw fatal;
}
