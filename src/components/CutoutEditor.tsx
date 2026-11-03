import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelCutout, ensureCutoutModel, releaseCutoutModel, runCutout } from '../ai/cutout';
import { acceleratorFor } from '../lib/compute';
import { ctx2d, LIMITS, makeCanvas } from '../lib/image';
import { useSettings } from '../lib/settings';
import { Icon } from './Icon';

type Tool = 'tap' | 'erase' | 'restore';
const MAX_UNDO = 6;

/**
 * AI 去背編輯器：
 * 1. 進入後自動以圖片中心點讓 AI 找出衣服
 * 2.「點選」：點在衣服上（可點多處，例如漏掉的袖子），AI 重新計算
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
  const [busy, setBusy] = useState<string | null>('準備 AI 去背');
  const [error, setError] = useState<string | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [hasMask, setHasMask] = useState(false);
  const undo = useRef<ImageData[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const stroke = useRef<{ x: number; y: number } | null>(null);
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
    });
  }, [work, tool, points]);

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

  const runAI = useCallback(async (pts: { x: number; y: number }[]) => {
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
      setHasMask(true);
      setLastMs(performance.now() - t0);
    } catch (e) {
      const m = (e as Error).message;
      if (m === '已取消') setError('已取消 AI 去背，可以重新點選衣服或改用筆刷');
      else setError(`AI 去背失敗：${m}`);
    } finally {
      setBusy(null);
      render();
    }
  }, [work, settings.backend, render, hasMask]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {tool === 'tap' ? (points.length > 1 ? '已點選多處，AI 會合併結果。點「重新點選」可重來' : '點一下衣服，AI 會自動找出衣服範圍；漏掉的部分可再點一下') : tool === 'erase' ? '用手指塗抹要去掉的地方' : '用手指塗抹要補回的地方'}
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
        <button className={`tool ${tool === 'erase' ? 'on' : ''}`} onClick={() => setTool('erase')}><Icon name="eraser" size={22} /><span>擦除</span></button>
        <button className={`tool ${tool === 'restore' ? 'on' : ''}`} onClick={() => setTool('restore')}><Icon name="brush" size={22} /><span>補回</span></button>
        <button className="tool" disabled={!undoCount} onClick={doUndo}><Icon name="undo" size={22} /><span>復原</span></button>
        <button className="tool" disabled={!!busy} onClick={() => { const p = [{ x: 0.5, y: 0.5 }]; setPoints(p); undo.current = []; setUndoCount(0); void runAI(p); }}><Icon name="rotate" size={22} /><span>重新點選</span></button>
      </div>
      {tool !== 'tap' && (
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
