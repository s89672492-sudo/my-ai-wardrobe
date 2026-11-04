/** 主執行緒端的 AI Worker 客戶端：請求/回應配對、取消、釋放。 */
import { AI_CACHE_NAME } from './assets';
import type { Accelerator, Keypoint, ModelName, WorkerRequest, WorkerResponse } from './protocol';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (s: string) => void };

/** 全域 AI 狀態（給畫面上的狀態提示用） */
export interface AIStatus { active: number; stage: string | null; since: number }
let status: AIStatus = { active: 0, stage: null, since: 0 };
const listeners = new Set<() => void>();
const emit = (s: AIStatus) => { status = s; listeners.forEach((l) => l()); };
export const aiStatus = {
  get: () => status,
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};
function begin(stage: string) { emit({ active: status.active + 1, stage, since: status.active ? status.since : Date.now() }); }
function end() { const a = Math.max(0, status.active - 1); emit({ active: a, stage: a ? status.stage : null, since: a ? status.since : 0 }); }

export class AIClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) { if (msg.type === 'result') msg.mask?.bitmap.close(); if (msg.type === 'cutoutResult' || msg.type === 'analyzeResult') msg.mask.close(); return; }
      if (msg.type === 'progress') { p.onProgress?.(msg.stage); emit({ ...status, stage: msg.stage }); return; }
      this.pending.delete(msg.id);
      if (msg.type !== 'disposed') end();
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    w.onerror = (e) => {
      const err = new Error(e.message || 'AI 背景程序發生錯誤');
      this.pending.forEach((p) => { p.reject(err); end(); });
      this.pending.clear();
    };
    this.worker = w;
    return w;
  }

  private send(req: Omit<WorkerRequest, 'id'> & { id?: number }, transfer: Transferable[] = [], onProgress?: (s: string) => void) {
    const id = req.id ?? this.nextId++;
    const w = this.ensure();
    return {
      id,
      promise: new Promise<WorkerResponse>((resolve, reject) => {
        if (req.type !== 'dispose') begin(req.type === 'init' ? '載入 AI' : 'AI 運算中');
        this.pending.set(id, { resolve, reject, onProgress });
        w.postMessage({ ...req, id }, transfer);
      }),
    };
  }

  init(wasmPath: string, accelerator: Accelerator, models: Partial<Record<ModelName, string>>, onProgress?: (s: string) => void) {
    return this.send({ type: 'init', wasmPath, cacheName: AI_CACHE_NAME, accelerator, models } as WorkerRequest, [], onProgress).promise;
  }

  process(bitmap: ImageBitmap, tasks: ModelName[], onProgress?: (s: string) => void) {
    return this.send({ type: 'process', bitmap, tasks } as WorkerRequest, [bitmap], onProgress);
  }

  cutout(bitmap: ImageBitmap, points: { x: number; y: number }[], onProgress?: (s: string) => void) {
    return this.send({ type: 'cutout', bitmap, points } as WorkerRequest, [bitmap], onProgress);
  }

  classify(bitmap: ImageBitmap) {
    return this.send({ type: 'classify', bitmap } as WorkerRequest, [bitmap]);
  }

  analyze(bitmap: ImageBitmap, onProgress?: (s: string) => void, keypointsHint?: Keypoint[]) {
    return this.send({ type: 'analyze', bitmap, keypointsHint } as WorkerRequest, [bitmap], onProgress);
  }

  /**
   * 取消：正在進行的單次推論無法中斷，但畫面立即解除等待，Worker 之後送回的結果會被丟棄（並釋放 ImageBitmap）。
   */
  cancel(targetId: number) {
    this.worker?.postMessage({ type: 'cancel', id: this.nextId++, targetId } satisfies WorkerRequest);
    const p = this.pending.get(targetId);
    if (p) { this.pending.delete(targetId); end(); p.resolve({ type: 'cancelled', id: targetId }); }
  }

  /** 釋放模型記憶體後終止 Worker（強制回收 wasm heap / GPU 資源）。 */
  async terminate() {
    if (!this.worker) return;
    try {
      await Promise.race([this.send({ type: 'dispose' } as WorkerRequest).promise, new Promise((r) => setTimeout(r, 1500))]);
    } catch { /* ignore */ }
    this.worker.terminate();
    this.worker = null;
    this.pending.forEach((p) => { p.reject(new Error('已取消')); end(); });
    this.pending.clear();
  }
}
