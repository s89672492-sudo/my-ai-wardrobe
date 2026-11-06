/**
 * 一次新增多件衣服：每張照片依序在手機上處理（一次一張，控制記憶體）：
 * 重複檢查 → AI 去背（以照片中心為衣服）→ 顏色 → AI 分類建議 → 儲存。
 * 結果可在衣服頁再修改（去背、分類、名稱）。
 */
import { classifyGarment } from '../ai/garment-classify';
import { ensureCutoutModel, runCutout } from '../ai/cutout';
import type { Accelerator } from '../ai/protocol';
import { createGarment, findDuplicate } from './garments';
import { alphaBBox, canvasToBlob, ctx2d, decodeImageFile, guessColor, imageProfile, LIMITS, makeCanvas, makeThumbnail, sha256 } from './image';
import { CATEGORIES, type CategoryId, type Garment, type Owner } from './types';

export type BatchResult =
  | { status: 'added'; garment: Garment; aiCategory: boolean; cutout: boolean }
  | { status: 'duplicate'; existing: Garment }
  | { status: 'error'; message: string };

export async function addGarmentFromFile(file: File, owner: Owner, accelerator: Accelerator, onStage: (s: string) => void): Promise<BatchResult> {
  try {
    onStage('檢查是否重複');
    const hash = await sha256(file);
    const dupe = await findDuplicate(hash);
    if (dupe) return { status: 'duplicate', existing: dupe };

    onStage('讀取照片');
    const bmp = await decodeImageFile(file, imageProfile().originalMaxSide);
    const orig = makeCanvas(bmp.width, bmp.height);
    ctx2d(orig).drawImage(bmp, 0, 0);
    bmp.close();
    const s = Math.min(1, LIMITS.cutoutMaxSide / Math.max(orig.width, orig.height));
    const work = s === 1 ? orig : makeCanvas(Math.round(orig.width * s), Math.round(orig.height * s));
    if (work !== orig) { const wx = ctx2d(work); wx.imageSmoothingQuality = 'high'; wx.drawImage(orig, 0, 0, work.width, work.height); }

    onStage('AI 去背');
    let out: HTMLCanvasElement = work, data: Uint8ClampedArray | null = null, didCutout = false;
    try {
      await ensureCutoutModel(accelerator, onStage);
      const m = await runCutout(await createImageBitmap(work), [{ x: 0.5, y: 0.5 }], onStage);
      const full = makeCanvas(work.width, work.height), fx = ctx2d(full, { willReadFrequently: true });
      fx.drawImage(work, 0, 0);
      fx.globalCompositeOperation = 'destination-in';
      fx.drawImage(m, 0, 0, work.width, work.height);
      m.close();
      const d = fx.getImageData(0, 0, full.width, full.height).data;
      const bb = alphaBBox(d, full.width, full.height);
      // 去背結果太小（多半沒點到衣服）就保留原圖，之後可在衣服頁重新去背
      if (bb && bb.w * bb.h > full.width * full.height * 0.04) {
        const pad = Math.round(Math.max(bb.w, bb.h) * 0.02);
        const sx = Math.max(0, bb.x - pad), sy = Math.max(0, bb.y - pad);
        out = makeCanvas(Math.min(full.width - sx, bb.w + 2 * pad), Math.min(full.height - sy, bb.h + 2 * pad));
        ctx2d(out).drawImage(full, sx, sy, out.width, out.height, 0, 0, out.width, out.height);
        data = d;
        didCutout = true;
      }
    } catch (e) {
      if ((e as Error).message === '已取消') throw e;
      // 去背失敗：仍以原圖新增
    }

    onStage('判斷種類與顏色');
    const color = data ? guessColor(data) : '';
    const sug = didCutout ? await classifyGarment(out) : null;
    const category: CategoryId = sug && sug.confidence >= 0.08 ? sug.category : 'tshirt';
    const label = CATEGORIES.find((c) => c.id === category)?.label ?? '';

    onStage('儲存');
    const garment = await createGarment(
      { name: `${color}${label}`, category, color, brand: '', size: '', seasons: [], notes: '', favorite: 0, styles: [], owner },
      {
        original: { blob: await canvasToBlob(orig, 'image/jpeg', imageProfile().jpegQ), width: orig.width, height: orig.height, hash },
        cutout: didCutout ? { blob: await canvasToBlob(out, 'image/png'), width: out.width, height: out.height } : null,
        thumb: { blob: await makeThumbnail(out), width: LIMITS.thumbSide, height: Math.round(LIMITS.thumbSide * 4 / 3) },
      },
    );
    return { status: 'added', garment, aiCategory: !!sug && sug.confidence >= 0.08, cutout: didCutout };
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }
}
