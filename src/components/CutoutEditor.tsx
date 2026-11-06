import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelCutout, ensureCutoutModel, releaseCutoutModel, runCutout } from '../ai/cutout';
import { acceleratorFor } from '../lib/compute';
import { ctx2d, LIMITS, makeCanvas } from '../lib/image';
import { useSettings } from '../lib/settings';
import { Icon } from './Icon';
import { recordMetric } from '../lib/metrics';
import { refineAlpha } from '../lib/matting';

type Tool = 'tap' | 'exclude' | 'erase' | 'restore';
const MAX_UNDO = 6;

/**
 * AI 去背編輯器：
 * 1. 進入後自動以圖片中心點讓 AI 找出衣服
 * 2.「點選」：點在衣服上（可點多處，例如漏掉的袖子），AI 重新計算
 *   「排除」：點在不要的東西上（例如黏在肩帶旁的衣架），AI 找出那一塊並扣掉
 *   AI 結果會再依照片顏色修飾邊緣（蕾絲、細肩帶較乾淨）
 * 3.「擦除 / 補回」筆刷手動修邊
 * 輸出：遮罩 canvas（白色 + alpha，與輸入同尺寸）
 */
export function CutoutEditor({ source, onDone, onSkip, onBack }: {
  source: HTMLCanvasElement;
  onDone: (image: HTMLCanvasElement, mask: HTMLCanvasElement) => void;
  onSkip: (image: HTMLCanvasElement) => void;
  onBack: () => void;
}) {
  const { settings } = useSettings();
  const [work] = useState(() => {
    // 編輯解析度上限，控制手機記憶體
    const s = Math.min(1, LIMITS.cutoutMaxSide / Math.max(source.width, source.height));
    if (s === 1) return source;
    const c = makeCanvas(source.width * s, source.height * s);
    const x = ctx2d(c);
    x.imageSmoothingQuality = 'high';
    x.drawImage(source, 0, 0, c.width, c.height);
    return c;
  });
  const mask = useRef(makeCanvas(work.width, work.height));
  const view = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tool, setTool] = useState<Tool>('tap');
  const [brush, setBrush] = useState(28);
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [exPoints, setExPoints] = useState<{ x: number; y: number }[]>([]);
  const [busy, setBusy] = useState<string | null>('準備 AI 去背');
  const [error, setError] = useState<string | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [hasMask, setHasMask] = useState(false);
  const undo = useRef<ImageData[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const stroke = useRef<{ x: number; y: number } | null>(null);
  /** 已排除的範圍（重新點選衣服後仍維持排除） */
  const excludes = useRef<HTMLCanvasElement[]>([]);
  const [refine, setRefine] = useState(true);
  const workPx = useRef<Uint8ClampedArray | null>(null);
  const raf = useRef(0);

  const render = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = view.current;
      if (!c) return;
      const x = ctx2d(c);
      x.clearRect(0, 0, c.width, c.height);
      if (tool !== 'tap') { x.globalAlpha = 0.28; x.drawImage(work, 0, 0, c.width, c.height); x.globalAlpha = 1; }
      const t = makeCanvas(c.width, c.height);
      const tx = ctx2d(t);
      tx.drawImage(work, 0, 0, t.width, t.height);
      tx.globalCompositeOperation = 'destination-in';
      tx.drawImage(mask.current, 0, 0, t.width, t.height);
      x.drawImage(t, 0, 0);
      x.fillStyle = '#ff2d55';
      for (const p of points) { x.beginPath(); x.arc(p.x * c.width, p.y * c.height, 7 * devicePixelRatio, 0, Math.PI * 2); x.fill(); }
      // 排除點：藍色叉叉
      x.strokeStyle = '#1d6fe0'; x.lineWidth = 3 * devicePixelRatio;
      for (const p of exPoints) {
        const cx = p.x * c.width, cy = p.y * c.height, r = 6 * devicePixelRatio;
        x.beginPath(); x.moveTo(cx - r, cy - r); x.lineTo(cx + r, cy + r); x.moveTo(cx + r, cy - r); x.lineTo(cx - r, cy + r); x.stroke();
      }
    });
  }, [work, tool, points, exPoints]);

  useEffect(() => {
    const el = wrap.current!;
    const fit = () => setScale(Math.min(el.clientWidth / work.width, (innerHeight * 0.55) / work.height));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [work]);

  useEffect(() => {
    const c = view.current!;
    c.width = Math.round(work.width * scale * devicePixelRatio);
    c.height = Math.round(work.height * scale * devicePixelRatio);
    render();
  }, [scale, work, render]);

  const pushUndo = () => {
    undo.current.push(ctx2d(mask.current).getImageData(0, 0, work.width, work.height));
    if (undo.current.length > MAX_UNDO) undo.current.shift();
    setUndoCount(undo.current.length);
  };

  const runAI = useCallback(async (pts: { x: number; y: number }[], refineOn = refine) => {
    setError(null);
    try {
      const t0 = performance.now();
      await ensureCutoutModel(acceleratorFor(settings), (s) => setBusy(s));
      setBusy('AI 去背中');
      const bmp = await createImageBitmap(work);
      const m = await runCutout(bmp, pts, (s) => setBusy(s));
      if (hasMask) pushUndo();
      const x = ctx2d(mask.current);
      x.clearRect(0, 0, work.width, work.height);
      x.imageSmoothingQuality = 'high';
      x.drawImage(m, 0, 0, work.width, work.height);
      m.close();
      if (refineOn) refineEdges();
      for (const ex of excludes.current) { x.globalCompositeOperation = 'destination-out'; x.drawImage(ex, 0, 0); }
      x.globalCompositeOperation = 'source-over';
      setHasMask(true);
      setLastMs(performance.now() - t0);
      recordMetric('cutout', performance.now() - t0, `${work.width}×${work.height}`);
    } catch (e) {
      const m = (e as Error).message;
      if (m === '已取消') setError('已取消 AI 去背，可以重新點選衣服或改用筆刷');
      else setError(`AI 去背失敗：${m}`);
    } finally {
      setBusy(null);
      render();
    }
  }, [work, settings.backend, render, hasMask, refine]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 依照片顏色修飾遮罩邊緣 */
  function refineEdges() {
    const w = work.width, h = work.height;
    workPx.current ??= ctx2d(work, { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const mx = ctx2d(mask.current, { willReadFrequently: true });
    const md = mx.getImageData(0, 0, w, h);
    const a = new Uint8ClampedArray(w * h);
    for (let i = 0; i < a.length; i++) a[i] = md.data[i * 4 + 3]!;
    const r = refineAlpha(workPx.current, a, w, h, Math.max(3, Math.round(Math.max(w, h) / 200)));
    for (let i = 0; i < a.length; i++) { md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = 255; md.data[i * 4 + 3] = r[i]!; }
    mx.putImageData(md, 0, 0);
  }

  /** 排除：點在不要的東西上，AI 找出那一塊後從遮罩扣掉 */
  async function runExclude(p: { x: number; y: number }) {
    setError(null);
    try {
      await ensureCutoutModel(acceleratorFor(settings), (s) => setBusy(s));
      setBusy('AI 排除中');
      const m = await runCutout(await createImageBitmap(work), [p], (s) => setBusy(s));
      const ex = document.createElement('canvas'); ex.width = work.width; ex.height = work.height;
      const ec = ctx2d(ex, { willReadFrequently: true });
      ec.drawImage(m, 0, 0, work.width, work.height);
      m.close();
      // 估算會扣掉多少衣服：超過六成代表 AI 認為那裡和衣服是同一塊，不扣
      const s = 8, sw = Math.ceil(work.width / s), sh = Math.ceil(work.height / s);
      const t = document.createElement('canvas'); t.width = sw; t.height = sh;
      const tx = ctx2d(t, { willReadFrequently: true });
      tx.drawImage(mask.current, 0, 0, sw, sh);
      const before = tx.getImageData(0, 0, sw, sh).data;
      tx.globalCompositeOperation = 'destination-in'; tx.drawImage(ex, 0, 0, sw, sh);
      const overlap = tx.getImageData(0, 0, sw, sh).data;
      let A = 0, O = 0; for (let i = 3; i < before.length; i += 4) { A += before[i]!; O += overlap[i]!; }
      if (A > 0 && O / A > 0.6) { setError('AI 判斷那裡和衣服是連在一起的同一塊，所以沒有扣掉。請改用「擦除」筆刷塗掉不要的部分。'); return; }
      if (O < A * 0.002) { setError('點的地方不在去背範圍內，沒有需要排除的部分。'); return; }
      pushUndo();
      const x = ctx2d(mask.current);
      x.globalCompositeOperation = 'destination-out'; x.drawImage(ex, 0, 0); x.globalCompositeOperation = 'source-over';
      excludes.current.push(ex);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg === '已取消' ? '已取消排除' : `AI 排除失敗：${msg}`);
    } finally { setBusy(null); render(); }
  }

  useEffect(() => {
    const first = [{ x: 0.5, y: 0.5 }];
    setPoints(first);
    void runAI(first);
    return () => { void releaseCutoutModel(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(render, [render]);

  const toWork = (e: React.PointerEvent) => {
    const r = view.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * work.width, y: ((e.clientY - r.top) / r.height) * work.height, nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
  };

  function paint(from: { x: number; y: number }, to: { x: number; y: number }) {
    const x = ctx2d(mask.current);
    x.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    x.strokeStyle = '#fff';
    x.lineCap = 'round';
    x.lineWidth = brush / scale;
    x.beginPath(); x.moveTo(from.x, from.y); x.lineTo(to.x, to.y); x.stroke();
    x.globalCompositeOperation = 'source-over';
    render();
  }

  function down(e: React.PointerEvent) {
    if (busy) return;
    const p = toWork(e);
    if (tool === 'exclude') { setExPoints((e) => [...e, { x: p.nx, y: p.ny }]); void runExclude({ x: p.nx, y: p.ny }); return; }
    if (tool === 'tap') {
      const pts = hasMask && points.length && !(points.length === 1 && points[0]!.x === 0.5 && points[0]!.y === 0.5) ? [...points, { x: p.nx, y: p.ny }] : [{ x: p.nx, y: p.ny }];
      setPoints(pts);
      void runAI(pts);
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    pushUndo();
    stroke.current = p;
    paint(p, p);
  }
  function move(e: React.PointerEvent) {
    if (!stroke.current) return;
    const p = toWork(e);
    paint(stroke.current, p);
    stroke.current = p;
  }
  const up = () => { stroke.current = null; };

  function doUndo() {
    const d = undo.current.pop();
    if (!d) return;
    ctx2d(mask.current).putImageData(d, 0, 0);
    setUndoCount(undo.current.length);
    render();
  }

  return (
    <div className="editor">
      <p className="editor-hint">
        {tool === 'tap' ? (points.length > 1 ? '已點選多處，AI 會合併結果。點「重新點選」可重來' : '點一下衣服，AI 會自動找出衣服範圍；漏掉的部分可再點一下') : tool === 'exclude' ? '點一下不要的東西（例如衣架、背景雜物），AI 會把那一塊扣掉' : tool === 'erase' ? '用手指塗抹要去掉的地方' : '用手指塗抹要補回的地方'}
      </p>
      <div ref={wrap} className="crop-wrap">
        <div className="cutout-stage checker" style={{ width: work.width * scale, height: work.height * scale }}>
          <canvas ref={view} style={{ width: '100%', height: '100%', touchAction: 'none' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          {busy && <div className="stage-busy"><span className="spinner" />{busy}{busy.startsWith('AI 去背') && <button className="btn btn-small" onClick={cancelCutout}>取消</button>}</div>}
        </div>
      </div>
      {error && <div className="alert alert-err">{error}</div>}
      {lastMs !== null && !busy && <p className="muted center">本機 AI 去背 {(lastMs / 1000).toFixed(1)} 秒</p>}
      <div className="editor-tools">
        <button className={`tool ${tool === 'tap' ? 'on' : ''}`} onClick={() => setTool('tap')}><Icon name="tap" size={22} /><span>點選</span></button>
        <button className={`tool ${tool === 'exclude' ? 'on' : ''}`} onClick={() => setTool('exclude')}><Icon name="close" size={22} /><span>排除</span></button>
        <button className={`tool ${tool === 'erase' ? 'on' : ''}`} onClick={() => setTool('erase')}><Icon name="eraser" size={22} /><span>擦除</span></button>
        <button className={`tool ${tool === 'restore' ? 'on' : ''}`} onClick={() => setTool('restore')}><Icon name="brush" size={22} /><span>補回</span></button>
        <button className="tool" disabled={!undoCount} onClick={doUndo}><Icon name="undo" size={22} /><span>復原</span></button>
        <button className="tool" disabled={!!busy} onClick={() => { const p = [{ x: 0.5, y: 0.5 }]; setPoints(p); setExPoints([]); excludes.current = []; undo.current = []; setUndoCount(0); void runAI(p); }}><Icon name="rotate" size={22} /><span>重新點選</span></button>
      </div>
      <label className="inline-check edge-refine"><input type="checkbox" checked={refine} onChange={(e) => { setRefine(e.target.checked); void runAI(points.length ? points : [{ x: 0.5, y: 0.5 }], e.target.checked); }} /> 依照片顏色修飾邊緣（蕾絲、細肩帶較乾淨）</label>
      {(tool === 'erase' || tool === 'restore') && (
        <label className="brush-size">筆刷大小
          <input type="range" min={8} max={80} value={brush} onChange={(e) => setBrush(+e.target.value)} />
        </label>
      )}
      <div className="editor-actions">
        <button className="btn" onClick={onBack}>上一步</button>
        <button className="btn btn-primary" disabled={!!busy || !hasMask} onClick={() => onDone(work, mask.current)}>完成去背</button>
      </div>
      <button className="link-btn" onClick={() => onSkip(work)}>不去背，直接使用原圖</button>
    </div>
  );
}
