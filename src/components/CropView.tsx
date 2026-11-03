import { useEffect, useRef, useState } from 'react';
import { ctx2d, makeCanvas } from '../lib/image';
import { Icon } from './Icon';

type Rect = { x: number; y: number; w: number; h: number };
type Drag = { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; sx: number; sy: number; start: Rect };
const MIN = 40;

/** 裁切：拖曳框內移動、拖曳四角調整大小，可旋轉 90°。座標以原圖像素計算。 */
export function CropView({ source, onDone, onBack }: { source: HTMLCanvasElement; onDone: (c: HTMLCanvasElement) => void; onBack: () => void }) {
  const [img, setImg] = useState(source);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: source.width, h: source.height });
  const [scale, setScale] = useState(1);
  const wrap = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const fit = () => setScale(Math.min(el.clientWidth / img.width, (innerHeight * 0.58) / img.height));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [img]);

  useEffect(() => {
    const c = view.current!;
    c.width = Math.round(img.width * scale * devicePixelRatio);
    c.height = Math.round(img.height * scale * devicePixelRatio);
    ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
  }, [img, scale]);

  function rotate() {
    const r = makeCanvas(img.height, img.width);
    const x = ctx2d(r);
    x.translate(r.width, 0);
    x.rotate(Math.PI / 2);
    x.drawImage(img, 0, 0);
    setImg(r);
    setRect({ x: img.height - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w });
  }

  function down(e: React.PointerEvent, mode: Drag['mode']) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: rect };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale, dy = (e.clientY - d.sy) / scale;
    const s = d.start, W = img.width, H = img.height;
    let { x, y, w, h } = s;
    if (d.mode === 'move') {
      x = Math.min(Math.max(0, s.x + dx), W - s.w);
      y = Math.min(Math.max(0, s.y + dy), H - s.h);
    } else {
      if (d.mode.includes('w')) { x = Math.min(Math.max(0, s.x + dx), s.x + s.w - MIN); w = s.x + s.w - x; }
      if (d.mode.includes('e')) w = Math.min(Math.max(MIN, s.w + dx), W - s.x);
      if (d.mode.includes('n')) { y = Math.min(Math.max(0, s.y + dy), s.y + s.h - MIN); h = s.y + s.h - y; }
      if (d.mode.includes('s')) h = Math.min(Math.max(MIN, s.h + dy), H - s.y);
    }
    setRect({ x, y, w, h });
  }
  const up = () => { drag.current = null; };

  function done() {
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
    if (r.x === 0 && r.y === 0 && r.w === img.width && r.h === img.height) return onDone(img);
    const out = makeCanvas(r.w, r.h);
    ctx2d(out).drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    onDone(out);
  }

  const st = (v: number) => `${v * scale}px`;
  return (
    <div className="editor">
      <p className="editor-hint">拖曳框線裁切，只留下衣服的範圍</p>
      <div ref={wrap} className="crop-wrap">
        <div className="crop-stage" style={{ width: st(img.width), height: st(img.height) }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <canvas ref={view} style={{ width: '100%', height: '100%' }} />
          <div className="crop-box" style={{ left: st(rect.x), top: st(rect.y), width: st(rect.w), height: st(rect.h) }} onPointerDown={(e) => down(e, 'move')}>
            {(['nw', 'ne', 'sw', 'se'] as const).map((m) => <span key={m} className={`crop-handle ${m}`} onPointerDown={(e) => down(e, m)} />)}
          </div>
        </div>
      </div>
      <div className="editor-tools">
        <button className="tool" onClick={rotate}><Icon name="rotate" size={22} /><span>旋轉</span></button>
        <button className="tool" onClick={() => setRect({ x: 0, y: 0, w: img.width, h: img.height })}><Icon name="expand" size={22} /><span>全圖</span></button>
      </div>
      <div className="editor-actions">
        <button className="btn" onClick={onBack}>重選照片</button>
        <button className="btn btn-primary" onClick={done}>下一步：去背</button>
      </div>
    </div>
  );
}
