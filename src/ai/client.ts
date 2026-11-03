/** 主執行緒端的 AI Worker 客戶端：請求/回應配對、取消、釋放。 */
import { AI_CACHE_NAME } from './assets';
import type { Accelerator, ModelName, WorkerRequest, WorkerResponse } from './protocol';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (s: string) => void };

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
      if (!p) { if (msg.type === 'result') msg.mask?.bitmap.close(); return; }
      if (msg.type === 'progress') { p.onProgress?.(msg.stage); return; }
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    w.onerror = (e) => {
      const err = new Error(e.message || 'AI 背景程序發生錯誤');
      this.pending.forEach((p) => p.reject(err));
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

  cancel(targetId: number) {
    this.worker?.postMessage({ type: 'cancel', id: this.nextId++, targetId } satisfies WorkerRequest);
  }

  /** 釋放模型記憶體後終止 Worker（強制回收 wasm heap / GPU 資源）。 */
  async terminate() {
    if (!this.worker) return;
    try {
      await Promise.race([this.send({ type: 'dispose' } as WorkerRequest).promise, new Promise((r) => setTimeout(r, 1500))]);
    } catch { /* ignore */ }
    this.worker.terminate();
    this.worker = null;
    this.pending.forEach((p) => p.reject(new Error('已取消')));
    this.pending.clear();
  }
}
