import { useEffect, useRef, useState } from 'react';
import { armCapsules, EDITABLE, MIN_SCORE, type BodyAnalysis } from '../ai/body';
import type { Keypoint } from '../ai/protocol';
import { ctx2d, makeCanvas } from '../lib/image';

export interface Layers { mask: boolean; arms: boolean; skeleton: boolean; measures: boolean }
const SKELETON: [number, number][] = [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];

/** 在照片上疊加 AI 人體辨識結果；editing 時可拖曳關鍵點校正。 */
export function BodyView({ photo, mask, analysis, layers, editing, onEdit }: {
  photo: HTMLCanvasElement;
  mask: HTMLCanvasElement | null;
  analysis: BodyAnalysis | null;
  layers: Layers;
  editing: boolean;
  onEdit: (kp: Keypoint[]) => void;
}) {
  const view = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const drag = useRef<number | null>(null);
  const [kpLocal, setKpLocal] = useState<Keypoint[] | null>(null);
  const kp = kpLocal ?? analysis?.keypoints ?? null;

  useEffect(() => {
    const el = wrap.current!;
    const fit = () => setScale(Math.min(el.clientWidth / photo.width, (innerHeight * 0.62) / photo.height));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [photo]);

  useEffect(() => {
    const c = view.current!;
    const dpr = devicePixelRatio;
    c.width = Math.round(photo.width * scale * dpr);
    c.height = Math.round(photo.height * scale * dpr);
    const x = ctx2d(c);
    const s = (scale * dpr);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(photo, 0, 0, c.width, c.height);
    x.setTransform(s, 0, 0, s, 0, 0);
    if (!analysis || !kp) return;
    const r = analysis.maskRect;
    const tint = (src: CanvasImageSource, color: string) => {
      const t = makeCanvas(c.width, c.height);
      const tx = ctx2d(t);
      tx.setTransform(s, 0, 0, s, 0, 0);
      tx.drawImage(src, r.x, r.y, r.w, r.h);
      tx.setTransform(1, 0, 0, 1, 0, 0);
      tx.globalCompositeOperation = 'source-in';
      tx.fillStyle = color;
      tx.fillRect(0, 0, t.width, t.height);
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(t, 0, 0); x.restore();
    };
    if (layers.mask && mask) tint(mask, 'rgba(59,130,246,0.38)');
    if (layers.arms && mask) {
      // 手臂遮擋區 = 手臂膠囊 ∩ 人體遮罩
      const a = makeCanvas(analysis.imageW, analysis.imageH);
      const ax = ctx2d(a);
      ax.lineCap = 'round';
      for (const cap of armCapsules({ ...analysis, keypoints: kp })) {
        ax.strokeStyle = analysis.arms[cap.side] === 'front' ? '#000' : 'rgba(0,0,0,0.55)';
        ax.lineWidth = cap.r * 2;
        ax.beginPath(); ax.moveTo(cap.a.x, cap.a.y); ax.lineTo(cap.b.x, cap.b.y); ax.stroke();
      }
      ax.globalCompositeOperation = 'destination-in';
      ax.drawImage(mask, r.x, r.y, r.w, r.h);
      const t = makeCanvas(c.width, c.height);
      const tx = ctx2d(t);
      tx.drawImage(a, 0, 0, t.width, t.height);
      tx.globalCompositeOperation = 'source-in';
      tx.fillStyle = 'rgba(249,115,22,0.6)';
      tx.fillRect(0, 0, t.width, t.height);
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(t, 0, 0); x.restore();
    }
    const u = 1 / scale; // 1 個螢幕像素
    if (layers.measures) {
      const A = analysis.anchors, m = analysis.measures;
      const sx = (A.shoulderL.x - A.shoulderR.x), sy = (A.shoulderL.y - A.shoulderR.y), sl = Math.hypot(sx, sy) || 1;
      const sc = { x: A.neck.x, y: A.neck.y + m.torsoLength * 0.12 };
      const lines: [number, number, number, number, string][] = [
        [sc.x - (sx / sl) * m.shoulderWidth / 2, sc.y - (sy / sl) * m.shoulderWidth / 2, sc.x + (sx / sl) * m.shoulderWidth / 2, sc.y + (sy / sl) * m.shoulderWidth / 2, '肩'],
        [A.waistR.x, A.waistR.y, A.waistL.x, A.waistL.y, '腰'],
        [A.hipR.x, A.hipR.y, A.hipL.x, A.hipL.y, '臀'],
      ];
      x.font = `600 ${13 * u}px -apple-system, sans-serif`;
      for (const [x0, y0, x1, y1, label] of lines) {
        x.strokeStyle = '#fff'; x.lineWidth = 4 * u; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
        x.strokeStyle = '#111'; x.lineWidth = 2 * u; x.setLineDash([6 * u, 4 * u]); x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); x.setLineDash([]);
        for (const [px, py] of [[x0, y0], [x1, y1]] as const) { x.fillStyle = '#111'; x.beginPath(); x.arc(px, py, 4 * u, 0, Math.PI * 2); x.fill(); }
        const lx = Math.min(x0, x1) - 22 * u;
        x.fillStyle = '#111'; x.fillRect(lx - 4 * u, (y0 + y1) / 2 - 10 * u, 22 * u, 20 * u);
        x.fillStyle = '#fff'; x.fillText(label, lx, (y0 + y1) / 2 + 5 * u);
      }
    }
    if (layers.skeleton || editing) {
      x.lineCap = 'round';
      for (const [a, b] of SKELETON) {
        const p = kp[a]!, q = kp[b]!;
        if (p.score < MIN_SCORE || q.score < MIN_SCORE) continue;
        x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 5 * u; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke();
        x.strokeStyle = '#10b981'; x.lineWidth = 3 * u; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke();
      }
      const idx = editing ? EDITABLE : kp.map((_, i) => i);
      for (const i of idx) {
        const p = kp[i]!;
        const rr = (editing ? 11 : 5) * u;
        x.fillStyle = p.score >= MIN_SCORE ? (editing ? 'rgba(255,45,85,0.9)' : '#ff2d55') : 'rgba(150,150,150,0.9)';
        x.strokeStyle = '#fff'; x.lineWidth = 2 * u;
        x.beginPath(); x.arc(p.x, p.y, rr, 0, Math.PI * 2); x.fill(); x.stroke();
      }
    }
  }, [photo, mask, analysis, kp, layers, scale, editing]);

  useEffect(() => { setKpLocal(null); }, [analysis]);

  const toImg = (e: React.PointerEvent) => {
    const r = view.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * photo.width, y: ((e.clientY - r.top) / r.height) * photo.height };
  };
  function down(e: React.PointerEvent) {
    if (!editing || !kp) return;
    const p = toImg(e);
    let best = -1, bd = 36 / scale;
    for (const i of EDITABLE) { const d = Math.hypot(kp[i]!.x - p.x, kp[i]!.y - p.y); if (d < bd) { bd = d; best = i; } }
    if (best < 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = best;
  }
  function move(e: React.PointerEvent) {
    if (drag.current === null || !kp) return;
    const p = toImg(e);
    const i = drag.current;
    const next = kp.map((k, j) => (j === i ? { ...k, x: Math.max(0, Math.min(photo.width, p.x)), y: Math.max(0, Math.min(photo.height, p.y)), score: Math.max(k.score, 0.99) } : k));
    setKpLocal(next);
  }
  function up() {
    if (drag.current !== null && kpLocal) onEdit(kpLocal);
    drag.current = null;
  }

  return (
    <div ref={wrap} className="crop-wrap">
      <div className="cutout-stage" style={{ width: photo.width * scale, height: photo.height * scale }}>
        <canvas ref={view} style={{ width: '100%', height: '100%', touchAction: editing ? 'none' : 'auto' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </div>
    </div>
  );
}
