/// <reference lib="webworker" />
/**
 * 試穿合成 Worker：在背景執行緒合成，拖曳調整時畫面不會卡住。
 * 人物照片與衣服圖只傳一次並保留在 Worker，之後每次合成只傳調整數值。
 */
import type { BodyAnalysis } from '../ai/body';
import { composeTryOn, releaseComposeMemory, type Layer } from './compose';
import type { ComposeWorkerRequest, ComposeWorkerResponse } from './compose-protocol';

const post = (m: ComposeWorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let person: { photo: HTMLCanvasElement; mask: HTMLCanvasElement | null; parse: HTMLCanvasElement | null; analysis: BodyAnalysis } | null = null;
const garments = new Map<string, HTMLCanvasElement>();

function toCanvas(b: ImageBitmap): HTMLCanvasElement {
  const c = new OffscreenCanvas(b.width, b.height);
  c.getContext('2d')!.drawImage(b, 0, 0);
  b.close();
  return c as unknown as HTMLCanvasElement;
}

self.onmessage = (e: MessageEvent<ComposeWorkerRequest>) => {
  const m = e.data;
  try {
    if (m.type === 'person') {
      // 新的人物（或重新辨識）：舊的快取跟著舊的 analysis 物件一起被回收
      person = { photo: toCanvas(m.photo), mask: m.mask ? toCanvas(m.mask) : null, parse: m.parse ? toCanvas(m.parse) : null, analysis: m.analysis };
      releaseComposeMemory();
    } else if (m.type === 'garment') {
      garments.set(m.key, toCanvas(m.image));
    } else if (m.type === 'forget') {
      for (const k of m.keys) garments.delete(k);
    } else if (m.type === 'compose') {
      if (!person) throw new Error('人物照片尚未載入');
      const layers: Layer[] = [];
      for (const l of m.layers) {
        const image = garments.get(l.key);
        if (!image) throw new Error('衣服圖片尚未載入');
        layers.push({ id: l.id, image, anchors: l.anchors, adjust: l.adjust, z: l.z, cutBelowT: l.cutBelowT, openFront: l.openFront });
      }
      const r = composeTryOn({ ...person, layers, draft: m.draft, showAnchors: m.showAnchors, grid: m.grid, draftGrid: m.draftGrid, shading: m.shading, eraseOld: m.eraseOld });
      const bitmap = (r.canvas as unknown as OffscreenCanvas).transferToImageBitmap();
      post({ type: 'composed', id: m.id, bitmap, notes: r.notes, ms: r.ms, anchors: r.anchors }, [bitmap]);
    }
  } catch (err) {
    post({ type: 'error', id: 'id' in m ? m.id : -1, message: err instanceof Error ? err.message : String(err) });
  }
};
