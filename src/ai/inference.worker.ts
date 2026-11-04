/**
 * AI 推論 Worker：持有 LiteRT.js runtime 與模型，避免阻塞 UI。
 * Wasm 載入 shim 與 accelerator 判斷改寫自 pravoobi/try-on
 * packages/litert-react/src/worker.ts（MIT）；模型前處理改寫自
 * packages/tryon-core/src/pose.ts / segmenter.ts（MIT），
 * 但不使用 tfjs，兩個模型都走 LiteRT 原生 Tensor，減少下載量。
 */
import { isWebGPUSupported, loadAndCompile, loadLiteRt, supportsFeature, Tensor, type CompiledModel } from '@litertjs/core';
import { computeLetterbox, unletterboxPoint } from './letterbox';
import { KEYPOINT_NAMES, type Accelerator, type Keypoint, type ModelLoadInfo, type ModelName, type WorkerRequest, type WorkerResponse } from './protocol';

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

interface LoadedModel { model: CompiledModel; h: number; w: number; dtype: string }
const models: Partial<Record<ModelName, LoadedModel>> = {};
let backend: Accelerator = 'wasm';
let runtimeLoaded = false;
const cancelled = new Set<number>();
const MODEL_LABEL: Record<ModelName, string> = { pose: '人體姿勢 MoveNet', segmenter: '人體分割 Selfie Segmenter', magicTouch: 'AI 去背 MagicTouch', parser: '人體部位分割 Multiclass', classifier: '衣服分類 EfficientNet-Lite0' };

let cacheName = 'ai-assets';
/** 已預先從 Cache Storage 取出的 glue 腳本（importScripts 是同步的，無法等待 Cache API） */
const prefetchedScripts = new Map<string, string>();

/**
 * 先查 Cache Storage，沒有才從網路下載並存入快取。
 * 由 Worker 自己管理快取，不依賴 Service Worker 是否攔截 Worker 內的請求。
 */
/** 下載進度回報（每 250ms 最多一次） */
let progressTarget: { id: number; label: string } | null = null;

async function cachedFetch(url: string): Promise<Response> {
  const abs = new URL(url, self.location.href).href;
  let cache: Cache | null = null;
  try { cache = await caches.open(cacheName); } catch { /* 私密瀏覽等情況可能無法使用快取 */ }
  const hit = await cache?.match(abs);
  if (hit) return hit;
  let res: Response;
  try { res = await fetch(abs); } catch {
    throw new Error(navigator.onLine ? '網路連線失敗，無法下載 AI 檔案' : '目前離線，且 AI 模型尚未下載到這支手機。請連上網路後到「設定 → 下載 AI 模型」');
  }
  if (!res.ok) throw new Error(`AI 檔案不存在或無法下載（HTTP ${res.status}）`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (progressTarget && res.body && total > 200_000) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0, last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      const now = performance.now();
      if (now - last > 250) { last = now; post({ type: 'progress', id: progressTarget.id, stage: got <= total ? `${progressTarget.label} ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB` : `${progressTarget.label} ${(got / 1048576).toFixed(1)} MB` }); } // gzip 傳輸時 content-length 是壓縮後大小
    }
    res = new Response(new Blob(chunks as BlobPart[]), { headers: res.headers });
  }
  if (cache) { try { await cache.put(abs, res.clone()); } catch { /* 空間不足時仍可繼續執行，只是不能離線 */ } }
  return res;
}

// LiteRT.js 以 importScripts 載入 wasm glue，但 module worker 沒有此函式 → 同步 eval 的 shim
function installImportScriptsShim() {
  (self as unknown as { importScripts: (...u: string[]) => void }).importScripts = (...urls: string[]) => {
    for (const url of urls) {
      const pre = prefetchedScripts.get(new URL(url, self.location.href).href);
      if (pre !== undefined) { (0, eval)(pre); continue; }
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send();
      if (xhr.status < 200 || xhr.status >= 300) throw new Error(`無法下載 AI 執行環境（HTTP ${xhr.status}）`);
      (0, eval)(xhr.responseText);
    }
  };
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init': void init(msg); break;
    case 'process': void processFrame(msg); break;
    case 'cutout': void cutout(msg); break;
    case 'analyze': void analyze(msg); break;
    case 'classify': void classify(msg); break;
    case 'cancel': cancelled.add(msg.targetId); break;
    case 'dispose': dispose(msg.id); break;
  }
};

async function init(msg: Extract<WorkerRequest, { type: 'init' }>) {
  const t0 = performance.now();
  let stage = 'runtime';
  try {
    const relaxedSimd = await supportsFeature('relaxedSimd');
    const jspi = await supportsFeature('jspi');
    let fallbackReason: string | undefined;
    cacheName = msg.cacheName;
    progressTarget = { id: msg.id, label: '下載 AI 執行環境' };
    if (!runtimeLoaded) {
      // WebGPU 推論在 LiteRT.js 需要 JSPI 版本的 wasm；不支援就用一般 CPU 版本
      const useJspi = msg.accelerator === 'webgpu' && jspi;
      // 與 LiteRT.js load() 相同的檔案選擇規則
      const base = !relaxedSimd ? 'litert_wasm_compat_internal' : useJspi ? 'litert_wasm_jspi_internal' : 'litert_wasm_internal';
      post({ type: 'progress', id: msg.id, stage: '下載 AI 執行環境（首次約 3 MB）' });
      const glueUrl = new URL(msg.wasmPath + base + '.js', self.location.href).href;
      const [glue, wasmBytes] = await Promise.all([
        cachedFetch(glueUrl).then((r) => r.text()),
        cachedFetch(msg.wasmPath + base + '.wasm').then((r) => r.arrayBuffer()),
      ]);
      prefetchedScripts.set(glueUrl, glue);
      installImportScriptsShim();
      (self as unknown as { Module: unknown }).Module = {
        locateFile: (f: string) => msg.wasmPath + f,
        // 用快取中的 wasm 位元組實例化，離線也能啟動
        instantiateWasm(imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) {
          WebAssembly.instantiate(wasmBytes, imports).then((r) => done(r.instance), (e: unknown) => console.error(e));
          return {};
        },
      };
      post({ type: 'progress', id: msg.id, stage: '啟動 AI 執行環境' });
      await loadLiteRt(msg.wasmPath, { jspi: useJspi });
      prefetchedScripts.clear();
      runtimeLoaded = true;
    }
    const runtimeMs = performance.now() - t0;
    backend = 'wasm';
    if (msg.accelerator === 'webgpu') {
      if (!isWebGPUSupported()) fallbackReason = '此瀏覽器不支援 WebGPU';
      else if (!jspi) fallbackReason = '此瀏覽器不支援 JSPI（LiteRT.js WebGPU 需要）';
      else backend = 'webgpu';
    }
    stage = 'models';
    const infos: ModelLoadInfo[] = [];
    for (const [name, url] of Object.entries(msg.models) as [ModelName, string][]) {
      post({ type: 'progress', id: msg.id, stage: `載入模型：${MODEL_LABEL[name]}` });
      const m0 = performance.now();
      try {
        models[name]?.model.delete();
        progressTarget = { id: msg.id, label: `下載${MODEL_LABEL[name]}` };
        const bytes = await fetchModel(url);
        let model: CompiledModel;
        try {
          model = await loadAndCompile(bytes, { accelerator: backend });
        } catch (gpuErr) {
          if (backend !== 'webgpu') throw gpuErr;
          // WebGPU 編譯失敗 → 自動退回 CPU
          fallbackReason = `WebGPU 編譯模型失敗，改用 CPU：${errMsg(gpuErr)}`;
          backend = 'wasm';
          model = await loadAndCompile(bytes, { accelerator: 'wasm' });
        }
        const inp = model.getInputDetails()[0];
        const out = model.getOutputDetails()[0];
        const channels = name === 'magicTouch' ? 4 : 3;
        if (!inp || inp.shape.length !== 4 || inp.shape[3] !== channels) throw new Error(`模型輸入格式不符 [${inp?.shape}]`);
        models[name] = { model, h: inp.shape[1]!, w: inp.shape[2]!, dtype: String(inp.dtype) };
        infos.push({ name, ok: true, ms: performance.now() - m0, input: `${inp.dtype}[${inp.shape}]`, output: `${out?.dtype}[${out?.shape}]` });
      } catch (err) {
        delete models[name];
        infos.push({ name, ok: false, ms: performance.now() - m0, error: errMsg(err) });
      }
    }
    progressTarget = null;
    post({ type: 'ready', id: msg.id, backend, requested: msg.accelerator, jspi, relaxedSimd, runtimeMs, models: infos, fallbackReason });
  } catch (err) {
    post({ type: 'error', id: msg.id, stage, message: errMsg(err) });
  }
}

async function processFrame(msg: Extract<WorkerRequest, { type: 'process' }>) {
  const { bitmap, id } = msg;
  const t0 = performance.now();
  try {
    const timings: { poseMs?: number; segmentMs?: number; parseMs?: number; totalMs: number } = { totalMs: 0 };
    let keypoints: Keypoint[] | undefined;
    let mask: { bitmap: ImageBitmap; width: number; height: number } | undefined;
    if (msg.tasks.includes('pose')) {
      if (cancelled.has(id)) return post({ type: 'cancelled', id });
      post({ type: 'progress', id, stage: '偵測人體姿勢' });
      const p0 = performance.now();
      keypoints = await runPose(bitmap);
      timings.poseMs = performance.now() - p0;
    }
    if (msg.tasks.includes('segmenter')) {
      if (cancelled.has(id)) return post({ type: 'cancelled', id });
      post({ type: 'progress', id, stage: '分割人體輪廓' });
      const s0 = performance.now();
      mask = await runSegmenter(bitmap);
      timings.segmentMs = performance.now() - s0;
    }
    let parse: { bitmap: ImageBitmap; width: number; height: number } | undefined;
    if (msg.tasks.includes('parser')) {
      if (cancelled.has(id)) { mask?.bitmap.close(); return post({ type: 'cancelled', id }); }
      post({ type: 'progress', id, stage: '辨識頭髮、皮膚與衣服' });
      const q0 = performance.now();
      parse = await runParser(bitmap);
      timings.parseMs = performance.now() - q0;
    }
    if (cancelled.has(id)) { mask?.bitmap.close(); parse?.bitmap.close(); return post({ type: 'cancelled', id }); }
    timings.totalMs = performance.now() - t0;
    post({ type: 'result', id, keypoints, mask, parse, timings }, [mask?.bitmap, parse?.bitmap].filter(Boolean) as ImageBitmap[]);
  } catch (err) {
    post({ type: 'error', id, stage: 'process', message: errMsg(err) });
  } finally {
    bitmap.close();
    cancelled.delete(id);
  }
}

/**
 * MediaPipe MagicTouch：輸入 [1,512,512,4]，RGB 0~1，第 4 通道為點選位置
 * （半徑 10px 的圓，1=點選處，0=其他）。編碼方式以合成測試圖對照真實遮罩驗證（IoU≈0.98）。
 */
async function cutout(msg: Extract<WorkerRequest, { type: 'cutout' }>) {
  const { bitmap, id, points } = msg;
  try {
    const m = models.magicTouch;
    if (!m) throw new Error('去背模型尚未載入');
    const t0 = performance.now();
    const c = new OffscreenCanvas(m.w, m.h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, m.w, m.h); // 與 MediaPipe 相同：直接縮放（不 letterbox）
    const rgba = ctx.getImageData(0, 0, m.w, m.h).data;
    const n = m.w * m.h;
    const base = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { base[i * 4] = rgba[i * 4]! / 255; base[i * 4 + 1] = rgba[i * 4 + 1]! / 255; base[i * 4 + 2] = rgba[i * 4 + 2]! / 255; }
    const acc = new Float32Array(n);
    const R = 10;
    for (const p of points.length ? points : [{ x: 0.5, y: 0.5 }]) {
      if (cancelled.has(id)) return post({ type: 'cancelled', id });
      post({ type: 'progress', id, stage: 'AI 去背中' });
      const f = base.slice();
      const cx = p.x * m.w, cy = p.y * m.h;
      for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(m.h - 1, Math.ceil(cy + R)); y++)
        for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(m.w - 1, Math.ceil(cx + R)); x++)
          if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) f[(y * m.w + x) * 4 + 3] = 1;
      const input = new Tensor(f, [1, m.h, m.w, 4]);
      let outs: Tensor[];
      try { outs = await m.model.run([input]); } finally { input.delete(); }
      try {
        const raw = (await outs[0]!.data()) as Float32Array;
        for (let i = 0; i < n; i++) if (raw[i]! > acc[i]!) acc[i] = raw[i]!;
      } finally { outs.forEach((t) => t.delete()); }
    }
    if (cancelled.has(id)) return post({ type: 'cancelled', id });
    // 輸出白色 + alpha 的遮罩；邊緣以 smoothstep 收斂，保留柔和邊
    const px = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, Math.max(0, (acc[i]! - 0.3) / 0.4));
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255;
      px[i * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255);
    }
    ctx.putImageData(new ImageData(px, m.w, m.h), 0, 0);
    const mask = await createImageBitmap(c);
    post({ type: 'cutoutResult', id, mask, ms: performance.now() - t0 }, [mask]);
  } catch (err) {
    post({ type: 'error', id, stage: 'cutout', message: errMsg(err) });
  } finally {
    bitmap.close();
    cancelled.delete(id);
  }
}

/**
 * 兩階段全身分析：
 * 1. 整張圖跑 MoveNet，取得人體大致範圍
 * 2. 以人體範圍（外擴）裁成正方形，再跑一次 MoveNet（官方建議的裁切推論，關鍵點更準）
 *    與 Selfie Segmenter（256×256 解析度集中在人身上，而非背景）
 * 若第一次信心太低，退回整張圖的結果。
 */
async function analyze(msg: Extract<WorkerRequest, { type: 'analyze' }>) {
  const { bitmap, id } = msg;
  const t0 = performance.now();
  try {
    const hint = msg.keypointsHint;
    if ((!models.pose && !hint) || !models.segmenter) throw new Error('人體辨識模型尚未載入');
    post({ type: 'progress', id, stage: '尋找人體位置' });
    const kp1 = hint ?? await runPose(bitmap);
    const pass1Ms = performance.now() - t0;
    if (cancelled.has(id)) return post({ type: 'cancelled', id });

    const good = kp1.filter((k) => k.score >= 0.25);
    let region = { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
    let refined = false;
    if (good.length >= 6) {
      const xs = good.map((k) => k.x), ys = good.map((k) => k.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const bh = y1 - y0, bw = x1 - x0;
      // 頭頂、腳底、手臂與衣服會超出關鍵點範圍，外擴
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - bh * 0.03;
      const side = Math.max(bh * 1.35, bw * 1.6);
      const rx = Math.max(0, Math.round(cx - side / 2)), ry = Math.max(0, Math.round(cy - side / 2));
      region = { x: rx, y: ry, w: Math.min(bitmap.width, Math.round(cx + side / 2)) - rx, h: Math.min(bitmap.height, Math.round(cy + side / 2)) - ry };
      refined = region.w * region.h < bitmap.width * bitmap.height * 0.9;
    }
    const crop = refined ? await createImageBitmap(bitmap, region.x, region.y, region.w, region.h) : bitmap;

    post({ type: 'progress', id, stage: '精確定位關鍵點' });
    const p0 = performance.now();
    let keypoints = refined && !hint ? (await runPose(crop)).map((k) => ({ ...k, x: k.x + region.x, y: k.y + region.y })) : kp1;
    // 第二次整體信心比第一次差時，逐點取較可信者
    if (refined && !hint) keypoints = keypoints.map((k, i) => (kp1[i]!.score > k.score + 0.15 ? kp1[i]! : k));
    const pass2Ms = performance.now() - p0;
    if (cancelled.has(id)) { if (crop !== bitmap) crop.close(); return post({ type: 'cancelled', id }); }

    post({ type: 'progress', id, stage: '分割人體輪廓' });
    const s0 = performance.now();
    const seg = await segmentTiled(crop);
    const segmentMs = performance.now() - s0;
    // 人體部位（頭髮／皮膚／衣服）：讓頭髮能蓋在衣服前、手臂遮擋用真實皮膚範圍、光影取自原本的衣服
    let parse: ImageBitmap | undefined, parseMs: number | undefined;
    if (models.parser && !cancelled.has(id)) {
      post({ type: 'progress', id, stage: '辨識頭髮、皮膚與衣服' });
      const q0 = performance.now();
      parse = (await runParser(crop)).bitmap;
      parseMs = performance.now() - q0;
    }
    if (crop !== bitmap) crop.close();
    if (cancelled.has(id)) { seg.bitmap.close(); parse?.close(); return post({ type: 'cancelled', id }); }
    post({ type: 'analyzeResult', id, keypoints, mask: seg.bitmap, maskRect: region, refined, parse,
      timings: { pass1Ms, pass2Ms, segmentMs, parseMs, totalMs: performance.now() - t0 } }, [seg.bitmap, ...(parse ? [parse] : [])]);
  } catch (err) {
    post({ type: 'error', id, stage: 'analyze', message: errMsg(err) });
  } finally {
    bitmap.close();
    cancelled.delete(id);
  }
}

function readPixels(src: ImageBitmap, w: number, h: number) {
  const lb = computeLetterbox(src.width, src.height, w, h);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('裝置不支援 OffscreenCanvas 2D');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, lb.dx, lb.dy, lb.scaledW, lb.scaledH);
  return { lb, rgba: ctx.getImageData(0, 0, w, h).data };
}

async function runPose(src: ImageBitmap): Promise<Keypoint[]> {
  const m = models.pose;
  if (!m) throw new Error('姿勢模型尚未載入');
  const { lb, rgba } = readPixels(src, m.w, m.h);
  const n = m.w * m.h;
  const rgb = m.dtype === 'uint8' ? new Uint8Array(n * 3) : m.dtype === 'int32' ? new Int32Array(n * 3) : new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { rgb[i * 3] = rgba[i * 4]!; rgb[i * 3 + 1] = rgba[i * 4 + 1]!; rgb[i * 3 + 2] = rgba[i * 4 + 2]!; }
  const input = new Tensor(rgb, [1, m.h, m.w, 3]);
  let outs: Tensor[];
  try { outs = await m.model.run([input]); } finally { input.delete(); }
  try {
    const data = (await outs[0]!.data()) as Float32Array;
    return KEYPOINT_NAMES.map((name, i) => {
      const p = unletterboxPoint(data[i * 3 + 1]! * m.w, data[i * 3]! * m.h, lb);
      return { name, x: p.x, y: p.y, score: data[i * 3 + 2]! };
    });
  } finally { outs.forEach((t) => t.delete()); }
}

/** 分割模型原始輸出（已去掉 letterbox 邊、已轉 0~1） */
async function segmentRaw(src: ImageBitmap): Promise<{ data: Float32Array; w: number; h: number }> {
  const m = models.segmenter;
  if (!m) throw new Error('分割模型尚未載入');
  const { lb, rgba } = readPixels(src, m.w, m.h);
  const n = m.w * m.h;
  const f = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { f[i * 3] = rgba[i * 4]! / 255; f[i * 3 + 1] = rgba[i * 4 + 1]! / 255; f[i * 3 + 2] = rgba[i * 4 + 2]! / 255; }
  const input = new Tensor(f, [1, m.h, m.w, 3]);
  let outs: Tensor[];
  try { outs = await m.model.run([input]); } finally { input.delete(); }
  try {
    const out = outs[0]!;
    const shape = Array.from(out.shape);
    const ch = shape.length === 4 ? shape[3]! : 1;
    const raw = (await out.data()) as Float32Array;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) { const v = raw[i * ch + ch - 1]!; if (v < min) min = v; if (v > max) max = v; }
    const logits = min < -0.001 || max > 1.001;
    const data = new Float32Array(lb.scaledW * lb.scaledH);
    for (let y = 0; y < lb.scaledH; y++) for (let x = 0; x < lb.scaledW; x++) {
      let v = raw[((y + lb.dy) * m.w + x + lb.dx) * ch + ch - 1]!;
      if (logits) v = 1 / (1 + Math.exp(-v));
      data[y * lb.scaledW + x] = v;
    }
    return { data, w: lb.scaledW, h: lb.scaledH };
  } finally { outs.forEach((t) => t.delete()); }
}

/**
 * 細長照片（例如直式全身照）切成數個重疊的正方形分別分割再合併，
 * 避免 256×256 模型有一半解析度浪費在 letterbox 補邊上。
 */
async function segmentTiled(src: ImageBitmap): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const m = models.segmenter!;
  const long = Math.max(src.width, src.height), short = Math.min(src.width, src.height);
  const tall = src.height >= src.width;
  const n = long / short < 1.25 ? 1 : Math.ceil((long / short) * 1.15);
  let outW: number, outH: number, out: Float32Array;
  if (n === 1) {
    const r = await segmentRaw(src);
    outW = r.w; outH = r.h; out = r.data;
  } else {
    const k = m.w / short; // 輸出像素 / 原圖像素
    outW = Math.round(src.width * k); outH = Math.round(src.height * k);
    out = new Float32Array(outW * outH);
    // 先放整張圖（低解析度）的結果，確保只有腿部的切片辨識不佳時仍有覆蓋
    const full = await segmentRaw(src);
    for (let y = 0; y < outH; y++) {
      const fy = Math.min(full.h - 1, (y / outH) * full.h);
      const y0 = Math.floor(fy), y1 = Math.min(full.h - 1, y0 + 1), wy = fy - y0;
      for (let x = 0; x < outW; x++) {
        const fx = Math.min(full.w - 1, (x / outW) * full.w);
        const x0 = Math.floor(fx), x1 = Math.min(full.w - 1, x0 + 1), wx = fx - x0;
        const d = full.data;
        out[y * outW + x] = (d[y0 * full.w + x0]! * (1 - wx) + d[y0 * full.w + x1]! * wx) * (1 - wy) + (d[y1 * full.w + x0]! * (1 - wx) + d[y1 * full.w + x1]! * wx) * wy;
      }
    }
    for (let t = 0; t < n; t++) {
      const off = Math.round(((long - short) * t) / (n - 1));
      const tile = await createImageBitmap(src, tall ? 0 : off, tall ? off : 0, short, short);
      const r = await segmentRaw(tile);
      tile.close();
      const o = Math.round(off * k);
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const X = tall ? x : x + o, Y = tall ? y + o : y;
        if (X >= outW || Y >= outH) continue;
        const i = Y * outW + X, v = r.data[y * r.w + x]!;
        if (v > out[i]!) out[i] = v;
      }
    }
  }
  const px = new Uint8ClampedArray(outW * outH * 4);
  for (let i = 0; i < out.length; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255; px[i * 4 + 3] = Math.round(out[i]! * 255); }
  const c = new OffscreenCanvas(outW, outH);
  c.getContext('2d')!.putImageData(new ImageData(px, outW, outH), 0, 0);
  return { bitmap: await createImageBitmap(c), width: outW, height: outH };
}

/**
 * MediaPipe Selfie Multiclass（256×256）：6 類 = 背景、頭髮、身體皮膚、臉部皮膚、衣服、其他（配件）。
 * 輸出不透明 RGB 圖（避免 alpha 預乘造成數值失真）：R=頭髮、G=皮膚（臉＋身體）、B=衣服。
 */
const PARSE_CLASSES = ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'] as const;
async function runParser(src: ImageBitmap): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const m = models.parser;
  if (!m) throw new Error('人體部位模型尚未載入');
  const { lb, rgba } = readPixels(src, m.w, m.h);
  const n = m.w * m.h;
  const f = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { f[i * 3] = rgba[i * 4]! / 255; f[i * 3 + 1] = rgba[i * 4 + 1]! / 255; f[i * 3 + 2] = rgba[i * 4 + 2]! / 255; }
  const input = new Tensor(f, [1, m.h, m.w, 3]);
  let outs: Tensor[];
  try { outs = await m.model.run([input]); } finally { input.delete(); }
  try {
    const out = outs[0]!;
    const ch = Array.from(out.shape).at(-1)!;
    if (ch < 5) throw new Error(`人體部位模型輸出格式不符 [${Array.from(out.shape)}]`);
    const raw = (await out.data()) as Float32Array;
    // 判斷輸出是機率（總和≈1）還是 logits，必要時做 softmax
    let isProb = true;
    for (let i = 0; i < 64 && isProb; i++) {
      let sum = 0;
      for (let k = 0; k < ch; k++) { const v = raw[i * ch + k]!; if (v < -0.001 || v > 1.001) isProb = false; sum += v; }
      if (Math.abs(sum - 1) > 0.05) isProb = false;
    }
    void PARSE_CLASSES;
    const px = new Uint8ClampedArray(n * 4);
    const p = new Float32Array(ch);
    for (let i = 0; i < n; i++) {
      if (isProb) for (let k = 0; k < ch; k++) p[k] = raw[i * ch + k]!;
      else {
        let mx = -Infinity; for (let k = 0; k < ch; k++) mx = Math.max(mx, raw[i * ch + k]!);
        let s = 0; for (let k = 0; k < ch; k++) { p[k] = Math.exp(raw[i * ch + k]! - mx); s += p[k]!; }
        for (let k = 0; k < ch; k++) p[k]! /= s;
      }
      px[i * 4] = Math.round(p[1]! * 255);
      px[i * 4 + 1] = Math.round(Math.min(1, p[2]! + p[3]!) * 255);
      px[i * 4 + 2] = Math.round(p[4]! * 255);
      px[i * 4 + 3] = 255;
    }
    const c = new OffscreenCanvas(m.w, m.h);
    c.getContext('2d')!.putImageData(new ImageData(px, m.w, m.h), 0, 0);
    const bitmap = await createImageBitmap(c, lb.dx, lb.dy, lb.scaledW, lb.scaledH);
    return { bitmap, width: lb.scaledW, height: lb.scaledH };
  } finally { outs.forEach((t) => t.delete()); }
}

async function runSegmenter(src: ImageBitmap) {
  const m = models.segmenter;
  if (!m) throw new Error('分割模型尚未載入');
  const { lb, rgba } = readPixels(src, m.w, m.h);
  const n = m.w * m.h;
  const f = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { f[i * 3] = rgba[i * 4]! / 255; f[i * 3 + 1] = rgba[i * 4 + 1]! / 255; f[i * 3 + 2] = rgba[i * 4 + 2]! / 255; }
  const input = new Tensor(f, [1, m.h, m.w, 3]);
  let outs: Tensor[];
  try { outs = await m.model.run([input]); } finally { input.delete(); }
  try {
    const out = outs[0]!;
    const shape = Array.from(out.shape);
    const ch = shape.length === 4 ? shape[3]! : 1;
    const raw = (await out.data()) as Float32Array;
    const px = new Uint8ClampedArray(n * 4);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) { const v = raw[i * ch + ch - 1]!; if (v < min) min = v; if (v > max) max = v; }
    const logits = min < -0.001 || max > 1.001;
    for (let i = 0; i < n; i++) {
      let v = raw[i * ch + ch - 1]!;
      if (logits) v = 1 / (1 + Math.exp(-v));
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255;
      px[i * 4 + 3] = Math.round(v * 255);
    }
    const c = new OffscreenCanvas(m.w, m.h);
    c.getContext('2d')!.putImageData(new ImageData(px, m.w, m.h), 0, 0);
    const bitmap = await createImageBitmap(c, lb.dx, lb.dy, lb.scaledW, lb.scaledH);
    return { bitmap, width: lb.scaledW, height: lb.scaledH };
  } finally { outs.forEach((t) => t.delete()); }
}

/**
 * 衣服分類（EfficientNet-Lite0 int8，ImageNet 1000 類）：輸入 uint8 [1,224,224,3]，
 * 衣服置中放在白底上（與商品照相同），輸出 uint8 [1,1000]（量化後的機率）。
 */
async function classify(msg: Extract<WorkerRequest, { type: 'classify' }>) {
  const { bitmap, id } = msg;
  try {
    const m = models.classifier;
    if (!m) throw new Error('分類模型尚未載入');
    const t0 = performance.now();
    const lb = computeLetterbox(bitmap.width, bitmap.height, m.w, m.h);
    const c = new OffscreenCanvas(m.w, m.h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, m.w, m.h);
    ctx.drawImage(bitmap, lb.dx, lb.dy, lb.scaledW, lb.scaledH);
    const rgba = ctx.getImageData(0, 0, m.w, m.h).data;
    const n = m.w * m.h;
    const rgb = m.dtype === 'uint8' ? new Uint8Array(n * 3) : new Float32Array(n * 3);
    const f = m.dtype === 'uint8' ? 1 : 1 / 255;
    for (let i = 0; i < n; i++) { rgb[i * 3] = rgba[i * 4]! * f; rgb[i * 3 + 1] = rgba[i * 4 + 1]! * f; rgb[i * 3 + 2] = rgba[i * 4 + 2]! * f; }
    const input = new Tensor(rgb, [1, m.h, m.w, 3]);
    let outs: Tensor[];
    try { outs = await m.model.run([input]); } finally { input.delete(); }
    try {
      const raw = await outs[0]!.data();
      const scale = raw instanceof Uint8Array ? 1 / 255 : 1;
      const all = Array.from(raw as ArrayLike<number>, (v, index) => ({ index, score: v * scale }));
      all.sort((a, b) => b.score - a.score);
      post({ type: 'classifyResult', id, top: all.slice(0, 15), ms: performance.now() - t0 });
    } finally { outs.forEach((t) => t.delete()); }
  } catch (err) {
    post({ type: 'error', id, stage: 'classify', message: errMsg(err) });
  } finally {
    bitmap.close();
    cancelled.delete(id);
  }
}

/** 下載並驗證 .tflite（檔頭第 4~7 位元組為 "TFL3"），避免把 404 頁面當模型載入。 */
async function fetchModel(url: string): Promise<Uint8Array> {
  const buf = new Uint8Array(await (await cachedFetch(url)).arrayBuffer());
  const magic = String.fromCharCode(...buf.subarray(4, 8));
  if (magic !== 'TFL3') {
    const abs = new URL(url, self.location.href).href;
    try { await (await caches.open(cacheName)).delete(abs); } catch { /* ignore */ }
    throw new Error(`下載到的不是 TFLite 模型（${(buf.length / 1024).toFixed(0)} KB，可能是模型尚未部署）`);
  }
  return buf;
}

function dispose(id: number) {
  for (const k of Object.keys(models) as ModelName[]) { models[k]?.model.delete(); delete models[k]; }
  post({ type: 'disposed', id });
}

function errMsg(e: unknown) { return e instanceof Error ? e.message : String(e); }
