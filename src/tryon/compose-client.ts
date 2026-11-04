/**
 * 試穿合成引擎：優先在背景 Worker 合成（OffscreenCanvas），不支援時改在主執行緒合成。
 * - schedule()：互動用（拖曳、滑桿），只保留最新一個請求，舊的直接略過，畫面不會越拖越慢
 * - run()：一定要結果的請求（例如儲存時的乾淨圖）
 */
import type { BodyAnalysis } from '../ai/body';
import { composeTryOn, releaseComposeMemory, type ComposeInput, type ComposeOutput } from './compose';
import type { ComposeLayerMsg, ComposeWorkerRequest, ComposeWorkerResponse } from './compose-protocol';

export type ComposeResult = Pick<ComposeOutput, 'canvas' | 'notes' | 'ms' | 'anchors'> & { inWorker: boolean };

let supported: boolean | null = null;
export function composeWorkerSupported(): boolean {
  if (supported !== null) return supported;
  try {
    supported = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('2d')
      && typeof (OffscreenCanvas.prototype as { transferToImageBitmap?: unknown }).transferToImageBitmap === 'function';
  } catch { supported = false; }
  return supported;
}

export class ComposeEngine {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, { resolve: (r: ComposeResult) => void; reject: (e: Error) => void; t0: number }>();
  private person: { photo: object; mask: object | null; parse: object | null; analysis: BodyAnalysis } | null = null;
  private garmentKeys = new WeakMap<object, string>();
  private sent = new Set<string>();
  private nextKey = 0;
  /** 互動請求：最多同時一個在跑、一個在排隊（最新的） */
  private busy = false;
  private queued: { inp: ComposeInput; cb: (r: ComposeResult | Error) => void } | null = null;
  /** 序列化「傳資料 → 合成」，避免 createImageBitmap 的非同步打亂順序 */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private useWorker = composeWorkerSupported()) {}

  get workerMode() { return this.useWorker; }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./compose.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<ComposeWorkerResponse>) => {
      const m = e.data, p = this.waiting.get(m.id);
      if (!p) { if (m.type === 'composed') m.bitmap.close(); return; }
      this.waiting.delete(m.id);
      if (m.type === 'error') { p.reject(new Error(m.message)); return; }
      // 轉成一般畫布：顯示、比較、儲存（toBlob）都沿用原本流程
      const c = document.createElement('canvas');
      c.width = m.bitmap.width; c.height = m.bitmap.height;
      c.getContext('2d')!.drawImage(m.bitmap, 0, 0);
      m.bitmap.close();
      p.resolve({ canvas: c, notes: m.notes, ms: performance.now() - p.t0, anchors: m.anchors, inWorker: true });
    };
    w.onerror = (e) => {
      // Worker 無法啟動（例如舊瀏覽器）：之後改在主執行緒合成
      e.preventDefault();
      this.useWorker = false;
      for (const [, p] of this.waiting) p.reject(new Error('背景合成無法啟動，已改用一般模式'));
      this.waiting.clear();
      this.worker?.terminate(); this.worker = null;
    };
    this.worker = w;
    return w;
  }

  private post(m: ComposeWorkerRequest, transfer: Transferable[] = []) { this.ensureWorker().postMessage(m, transfer); }

  private async sync(inp: ComposeInput) {
    const p = this.person;
    if (!p || p.photo !== inp.photo || p.mask !== inp.mask || p.parse !== (inp.parse ?? null) || p.analysis !== inp.analysis) {
      const [photo, mask, parse] = await Promise.all([
        createImageBitmap(inp.photo),
        inp.mask ? createImageBitmap(inp.mask) : null,
        inp.parse ? createImageBitmap(inp.parse) : null,
      ]);
      this.post({ type: 'person', photo, mask, parse, analysis: inp.analysis }, [photo, ...(mask ? [mask] : []), ...(parse ? [parse] : [])]);
      this.person = { photo: inp.photo, mask: inp.mask, parse: inp.parse ?? null, analysis: inp.analysis };
    }
    const layers: ComposeLayerMsg[] = [];
    for (const l of inp.layers) {
      let key = this.garmentKeys.get(l.image);
      if (!key) { key = `g${this.nextKey++}`; this.garmentKeys.set(l.image, key); }
      if (!this.sent.has(key)) {
        const bmp = await createImageBitmap(l.image);
        this.post({ type: 'garment', key, image: bmp }, [bmp]);
        this.sent.add(key);
      }
      const { image: _img, ...rest } = l;
      layers.push({ ...rest, key });
    }
    return layers;
  }

  /** 一定要結果的合成 */
  run(inp: ComposeInput): Promise<ComposeResult> {
    if (!this.useWorker) {
      return new Promise((resolve, reject) => {
        try { const r = composeTryOn(inp); resolve({ ...r, inWorker: false }); } catch (e) { reject(e as Error); }
      });
    }
    const job = this.chain.then(async () => {
      const layers = await this.sync(inp);
      const id = ++this.seq;
      const t0 = performance.now();
      const done = new Promise<ComposeResult>((resolve, reject) => this.waiting.set(id, { resolve, reject, t0 }));
      this.post({ type: 'compose', id, layers, draft: inp.draft, showAnchors: inp.showAnchors, grid: inp.grid, draftGrid: inp.draftGrid, shading: inp.shading });
      return done;
    });
    this.chain = job.catch(() => undefined);
    // Worker 失效時自動改用主執行緒重試一次
    return job.catch((e: Error) => (this.useWorker ? Promise.reject(e) : this.run(inp)));
  }

  /** 互動用：只算最新的一個 */
  schedule(inp: ComposeInput, cb: (r: ComposeResult | Error) => void) {
    if (this.busy) { this.queued = { inp, cb }; return; }
    this.busy = true;
    void this.run(inp).then(cb, cb).finally(() => {
      this.busy = false;
      const q = this.queued;
      this.queued = null;
      if (q) this.schedule(q.inp, q.cb);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.waiting.clear();
    this.queued = null;
    this.person = null;
    this.sent.clear();
    releaseComposeMemory();
  }
}
