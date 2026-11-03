import { useEffect, useRef, useState } from 'react';
import { AIClient } from './ai/client';
import { detectDevice, recommendMode, type DeviceReport } from './ai/device';
import type { Accelerator, Keypoint, ModelLoadInfo, WorkerResponse } from './ai/protocol';

type Mode = 'high' | 'balanced' | 'saver';
const MODE_LABEL: Record<Mode, string> = { high: '高品質', balanced: '平衡', saver: '省電' };
const MODE_SIDE: Record<Mode, number> = { high: 1536, balanced: 1024, saver: 640 };
const BASE = import.meta.env.BASE_URL;
const MODEL_URLS = {
  pose: `${BASE}models/movenet_singlepose_lightning.tflite`,
  segmenter: `${BASE}models/selfie_segmenter.tflite`,
};
const SKELETON: [number, number][] = [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
const KP_ZH: Record<string, string> = {
  left_shoulder: '左肩', right_shoulder: '右肩', left_elbow: '左手肘', right_elbow: '右手肘', left_wrist: '左手腕', right_wrist: '右手腕',
  left_hip: '左臀', right_hip: '右臀', left_knee: '左膝', right_knee: '右膝', left_ankle: '左腳踝', right_ankle: '右腳踝',
};

interface RunResult { keypoints?: Keypoint[]; timings: { poseMs?: number; segmentMs?: number; totalMs: number; roundTripMs: number }; heapMB?: number }
interface LogLine { t: string; text: string; level: 'info' | 'ok' | 'warn' | 'err' }

const client = new AIClient();

function heapMB(): number | undefined {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize / 1048576 : undefined;
}

export default function App() {
  const [device, setDevice] = useState<DeviceReport | null>(null);
  const [mode, setMode] = useState<Mode>('balanced');
  const [accel, setAccel] = useState<'auto' | Accelerator>('auto');
  const [ready, setReady] = useState<Extract<WorkerResponse, { type: 'ready' }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
  const [photoInfo, setPhotoInfo] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [bench, setBench] = useState<number[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [uiTick, setUiTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningId = useRef<number | null>(null);
  const maskRef = useRef<ImageBitmap | null>(null);

  const addLog = (text: string, level: LogLine['level'] = 'info') =>
    setLog((l) => [...l.slice(-60), { t: new Date().toLocaleTimeString('zh-TW', { hour12: false }), text, level }]);

  useEffect(() => {
    detectDevice().then((d) => {
      setDevice(d);
      const rec = recommendMode(d);
      setMode(rec.mode);
      addLog(`建議運算模式：${MODE_LABEL[rec.mode]}（${rec.reason}）`);
    });
    // UI 流暢度指標：推論時若主執行緒被阻塞，這個計數會停住
    const iv = setInterval(() => setUiTick((t) => t + 1), 100);
    return () => clearInterval(iv);
  }, []);

  const resolvedAccel = (): Accelerator => (accel === 'auto' ? (device?.webgpuAdapter === 'ok' ? 'webgpu' : 'wasm') : accel);

  async function loadModels() {
    setBusy('載入中');
    setReady(null);
    await client.terminate();
    const want = resolvedAccel();
    addLog(`開始載入模型，要求後端：${want === 'webgpu' ? 'WebGPU' : 'WASM CPU'}`);
    const t0 = performance.now();
    try {
      const r = (await client.init(`${BASE}litert-wasm/`, want, MODEL_URLS, (s) => setBusy(s))) as Extract<WorkerResponse, { type: 'ready' }>;
      setReady(r);
      addLog(`AI 執行環境就緒：實際使用 ${r.backend === 'webgpu' ? 'WebGPU' : 'WASM CPU'}，共 ${(performance.now() - t0).toFixed(0)} ms`, 'ok');
      if (r.fallbackReason) addLog(`已自動切換為 CPU：${r.fallbackReason}`, 'warn');
      r.models.forEach((m) => addLog(m.ok ? `✓ ${modelZh(m)} 載入成功（${m.ms.toFixed(0)} ms）輸入 ${m.input}` : `✗ ${modelZh(m)} 載入失敗：${friendly(m.error)}`, m.ok ? 'ok' : 'err'));
    } catch (e) {
      addLog(`載入失敗：${friendly(errText(e))}`, 'err');
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return addLog('請選擇圖片檔案', 'err');
    try {
      const probe = await createImageBitmap(file);
      const side = MODE_SIDE[mode];
      const scale = Math.min(1, side / Math.max(probe.width, probe.height));
      const w = Math.round(probe.width * scale), h = Math.round(probe.height * scale);
      const bmp = scale < 1 ? await createImageBitmap(probe, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }) : probe;
      if (bmp !== probe) probe.close();
      photo?.close();
      setPhoto(bmp);
      setResult(null);
      setBench([]);
      maskRef.current?.close();
      maskRef.current = null;
      setPhotoInfo(`${(file.size / 1024).toFixed(0)} KB，原始 ${Math.round(w / scale)}×${Math.round(h / scale)} → 處理 ${w}×${h}（${MODE_LABEL[mode]}模式上限 ${side}px）`);
      addLog('照片已在本機讀取（未上傳）', 'ok');
    } catch (e) {
      addLog(`無法讀取照片：${errText(e)}。iPhone 若為 HEIC 格式，請在「設定 → 相機 → 格式」選「最相容」後重試。`, 'err');
    }
  }

  async function run(times = 1) {
    if (!photo || !ready) return;
    const tasks = ready.models.filter((m) => m.ok).map((m) => m.name);
    if (!tasks.length) return addLog('沒有可用的模型', 'err');
    setBusy('推論中');
    const samples: number[] = [];
    try {
      for (let i = 0; i < times; i++) {
        const copy = await createImageBitmap(photo); // 原圖保留在主執行緒，複本轉移到 Worker
        const t0 = performance.now();
        const req = client.process(copy, tasks, (s) => setBusy(times > 1 ? `第 ${i + 1}/${times} 次：${s}` : s));
        runningId.current = req.id;
        const r = await req.promise;
        if (r.type === 'cancelled') { addLog('推論已取消', 'warn'); return; }
        if (r.type !== 'result') return;
        const rt = performance.now() - t0;
        samples.push(rt);
        maskRef.current?.close();
        maskRef.current = r.mask?.bitmap ?? null;
        setResult({ keypoints: r.keypoints, timings: { ...r.timings, roundTripMs: rt }, heapMB: heapMB() });
      }
      if (times > 1) {
        setBench(samples);
        addLog(`連續 ${times} 次：第 1 次 ${samples[0]!.toFixed(0)} ms，之後平均 ${avg(samples.slice(1)).toFixed(0)} ms`, 'ok');
      } else addLog(`推論完成：${samples[0]!.toFixed(0)} ms`, 'ok');
    } catch (e) {
      addLog(`推論失敗：${friendly(errText(e))}`, 'err');
    } finally {
      runningId.current = null;
      setBusy(null);
    }
  }

  function cancel() {
    if (runningId.current !== null) client.cancel(runningId.current);
  }

  async function release() {
    await client.terminate();
    maskRef.current?.close();
    maskRef.current = null;
    setReady(null);
    setResult(null);
    addLog('已釋放模型與 Worker 記憶體', 'ok');
  }

  // 繪製結果
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !photo) return;
    c.width = photo.width;
    c.height = photo.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(photo, 0, 0);
    const mask = maskRef.current;
    if (mask) {
      const tmp = new OffscreenCanvas(photo.width, photo.height);
      const t = tmp.getContext('2d')!;
      t.imageSmoothingQuality = 'high';
      t.drawImage(mask, 0, 0, photo.width, photo.height);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = 'rgba(80,140,255,0.45)';
      t.fillRect(0, 0, photo.width, photo.height);
      ctx.drawImage(tmp, 0, 0);
    }
    const kp = result?.keypoints;
    if (kp) {
      const r = Math.max(4, photo.width / 120);
      ctx.lineWidth = r * 0.7;
      ctx.strokeStyle = '#00e08a';
      for (const [a, b] of SKELETON) {
        const p = kp[a]!, q = kp[b]!;
        if (p.score < 0.3 || q.score < 0.3) continue;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      for (const p of kp) {
        ctx.fillStyle = p.score >= 0.3 ? '#ff3b6b' : 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  }, [photo, result]);

  function exportReport() {
    const report = { time: new Date().toISOString(), mode, accel, device, ready, photoInfo, result: result && { ...result, keypoints: result.keypoints?.map((k) => ({ ...k, x: Math.round(k.x), y: Math.round(k.y), score: +k.score.toFixed(3) })) }, bench, log };
    const text = JSON.stringify(report, null, 2);
    navigator.clipboard?.writeText(text).then(() => addLog('測試報告已複製到剪貼簿（不含照片）', 'ok'), () => download(text));
  }

  return (
    <main>
      <header>
        <h1>My AI Wardrobe</h1>
        <p className="sub">Phase 0 · 手機端技術驗證</p>
        <p className="privacy">🔒 照片只在本機處理，不會上傳。AI 模型下載一次後在手機上執行。</p>
      </header>

      <section className="card">
        <h2>1. 裝置能力</h2>
        {!device ? <p>偵測中…</p> : (
          <dl>
            <Row k="系統" v={device.isIOS ? 'iOS / iPadOS' : device.isAndroid ? 'Android' : device.platform} />
            <Row k="WebGPU API" v={yn(device.webgpuApi)} />
            <Row k="WebGPU 轉接器" v={{ ok: '✅ 可用', none: '❌ 無可用 GPU', error: `❌ ${device.webgpuError}`, 'n/a': '—' }[device.webgpuAdapter]} />
            {device.webgpuInfo && <Row k="GPU" v={device.webgpuInfo} />}
            {device.maxBufferMB && <Row k="GPU 最大緩衝" v={`${device.maxBufferMB.toFixed(0)} MB`} />}
            <Row k="記憶體 (deviceMemory)" v={device.deviceMemoryGB ? `${device.deviceMemoryGB} GB` : '瀏覽器未提供'} />
            <Row k="CPU 核心" v={device.cores ? String(device.cores) : '瀏覽器未提供'} />
            <Row k="JS Heap 上限" v={device.jsHeapLimitMB ? `${device.jsHeapLimitMB.toFixed(0)} MB` : '瀏覽器未提供'} />
            <Row k="Module Worker" v={yn(device.moduleWorker)} />
            <Row k="OffscreenCanvas" v={yn(device.offscreenCanvas)} />
            <Row k="IndexedDB" v={yn(device.indexedDB)} />
            <Row k="Service Worker" v={yn(device.serviceWorker)} />
            <Row k="跨來源隔離 (多執行緒)" v={device.crossOriginIsolated ? '✅' : '❌（GitHub Pages 預設無法啟用）'} />
            <Row k="儲存空間" v={device.storageQuotaMB ? `已用 ${device.storageUsageMB!.toFixed(1)} / 配額 ${device.storageQuotaMB.toFixed(0)} MB` : '瀏覽器未提供'} />
            <Row k="永久儲存" v={device.storagePersisted ? '✅ 已授權' : '未授權（瀏覽器可能清除）'} />
            <Row k="已安裝為 App" v={yn(device.standalone)} />
          </dl>
        )}
      </section>

      <section className="card">
        <h2>2. 載入 AI 模型</h2>
        <label>運算模式
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} disabled={!!busy}>
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}（照片上限 {MODE_SIDE[m]}px）</option>)}
          </select>
        </label>
        <label>運算後端
          <select value={accel} onChange={(e) => setAccel(e.target.value as typeof accel)} disabled={!!busy}>
            <option value="auto">自動（WebGPU 可用則使用）</option>
            <option value="webgpu">強制嘗試 WebGPU</option>
            <option value="wasm">WASM CPU</option>
          </select>
        </label>
        <button className="primary" onClick={loadModels} disabled={!!busy || !device}>載入模型</button>
        {ready && (
          <dl>
            <Row k="實際後端" v={ready.backend === 'webgpu' ? '⚡ WebGPU' : '🧮 WASM CPU'} />
            <Row k="JSPI" v={yn(ready.jspi)} />
            <Row k="Relaxed SIMD" v={yn(ready.relaxedSimd)} />
            <Row k="執行環境載入" v={`${ready.runtimeMs.toFixed(0)} ms`} />
            {ready.models.map((m) => <Row key={m.name} k={modelZh(m)} v={m.ok ? `✅ ${m.ms.toFixed(0)} ms` : `❌ ${friendly(m.error)}`} />)}
          </dl>
        )}
      </section>

      <section className="card">
        <h2>3. 選擇全身照片</h2>
        <div className="row">
          <label className="btn">📷 拍照<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <label className="btn">🖼️ 相簿<input type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>
        {photoInfo && <p className="muted">{photoInfo}</p>}
      </section>

      <section className="card">
        <h2>4. Worker 推論</h2>
        <div className="row">
          <button className="primary" onClick={() => run(1)} disabled={!!busy || !photo || !ready}>執行一次</button>
          <button onClick={() => run(5)} disabled={!!busy || !photo || !ready}>連續 5 次測速</button>
        </div>
        <div className="row">
          <button onClick={cancel} disabled={!busy || runningId.current === null}>取消</button>
          <button onClick={release} disabled={!!busy}>釋放記憶體</button>
        </div>
        <p className="status">{busy ? `⏳ ${busy}` : '閒置'} <span className="tick" title="UI 流暢度指標：推論時持續跳動表示沒有阻塞畫面">● {uiTick % 100}</span></p>
        {photo && <canvas ref={canvasRef} className="preview" />}
        {result && (
          <dl>
            {result.timings.poseMs !== undefined && <Row k="姿勢辨識" v={`${result.timings.poseMs.toFixed(0)} ms`} />}
            {result.timings.segmentMs !== undefined && <Row k="人體分割" v={`${result.timings.segmentMs.toFixed(0)} ms`} />}
            <Row k="Worker 內合計" v={`${result.timings.totalMs.toFixed(0)} ms`} />
            <Row k="含傳輸往返" v={`${result.timings.roundTripMs.toFixed(0)} ms`} />
            <Row k="主執行緒 JS Heap" v={result.heapMB !== undefined ? `${result.heapMB.toFixed(0)} MB` : '此瀏覽器不提供（iOS 無此 API）'} />
            {bench.length > 1 && <Row k="5 次（首次 / 平均）" v={`${bench[0]!.toFixed(0)} / ${avg(bench.slice(1)).toFixed(0)} ms`} />}
          </dl>
        )}
        {result?.keypoints && (
          <table className="kp">
            <thead><tr><th>部位</th><th>x, y</th><th>信心</th></tr></thead>
            <tbody>
              {result.keypoints.filter((k) => KP_ZH[k.name]).map((k) => (
                <tr key={k.name} className={k.score < 0.3 ? 'low' : ''}><td>{KP_ZH[k.name]}</td><td>{Math.round(k.x)}, {Math.round(k.y)}</td><td>{(k.score * 100).toFixed(0)}%</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>5. 紀錄</h2>
        <button onClick={exportReport}>複製測試報告（不含照片）</button>
        <ol className="log">{log.map((l, i) => <li key={i} className={l.level}><time>{l.t}</time> {l.text}</li>)}</ol>
      </section>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) { return <><dt>{k}</dt><dd>{v}</dd></>; }
const yn = (b: boolean) => (b ? '✅' : '❌');
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const modelZh = (m: ModelLoadInfo) => (m.name === 'pose' ? '姿勢模型 MoveNet' : '分割模型 Selfie Segmenter');
function friendly(msg?: string) {
  if (!msg) return '未知錯誤';
  if (/404|Failed to fetch|NetworkError|HTTP/.test(msg)) return `模型檔案下載失敗，請確認網路連線或模型是否已部署（${msg}）`;
  if (/memory|OOM|allocation/i.test(msg)) return `手機記憶體不足，請改用省電模式（${msg}）`;
  return msg;
}
function download(text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = 'wardrobe-phase0-report.json';
  a.click();
}
