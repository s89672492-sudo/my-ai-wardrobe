import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { EmptyState, PageHeader } from '../components/ui';
import { getImageBlob, listGarments } from '../lib/garments';
import { ctx2d, makeCanvas } from '../lib/image';
import { getPerson } from '../lib/persons';
import { href, navigate } from '../lib/router';
import { saveFile } from '../lib/backup';
import { saveTryOn } from '../lib/tryons';
import type { Garment, PersonPhoto } from '../lib/types';
import { useImageUrl } from '../lib/useImageUrl';
import { NO_ADJUST, type Adjust } from '../tryon/bodyTargets';
import { composeTryOn } from '../tryon/compose';
import { detectAnchors, KIND_OF, KIND_ZH, type GarmentAnchors } from '../tryon/garmentAnchors';

type Mode = 'result' | 'compare' | 'adjust';
interface Loaded { garment: Garment; image: HTMLCanvasElement; anchors: GarmentAnchors | null; cutout: boolean }
const GARMENT_MAX = 900;

async function blobCanvas(b: Blob, max = Infinity) {
  const bmp = await createImageBitmap(b);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = makeCanvas(bmp.width * s, bmp.height * s);
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

async function loadGarment(g: Garment): Promise<Loaded> {
  const b = await getImageBlob(g.cutoutImageId ?? g.originalImageId);
  if (!b) throw new Error('找不到衣服圖片');
  const image = await blobCanvas(b, GARMENT_MAX);
  const kind = KIND_OF[g.category];
  const data = ctx2d(image, { willReadFrequently: true }).getImageData(0, 0, image.width, image.height).data;
  return { garment: g, image, anchors: kind ? detectAnchors(data, image.width, image.height, kind) : null, cutout: !!g.cutoutImageId };
}

export function TryOnStudio({ personId, garmentId }: { personId: string; garmentId?: string }) {
  const [person, setPerson] = useState<PersonPhoto | null>(null);
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null);
  const [garments, setGarments] = useState<Garment[] | null>(null);
  const [selected, setSelected] = useState<string | null>(garmentId ?? null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [adjust, setAdjust] = useState<Adjust>(NO_ADJUST);
  const [mode, setMode] = useState<Mode>('result');
  const [split, setSplit] = useState(0.5);
  const [showAnchors, setShowAnchors] = useState(false);
  const [result, setResult] = useState<{ canvas: HTMLCanvasElement; notes: string[]; ms: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; kind: 'move' | 'split' } | null>(null);
  const [dragging, setDragging] = useState(false);

  // 載入人物與衣櫥
  useEffect(() => {
    void (async () => {
      try {
        const p = await getPerson(personId);
        if (!p) throw new Error('找不到這張全身照，可能已被刪除');
        if (!p.analysis) throw new Error('這張全身照尚未完成 AI 人體辨識');
        setPerson(p);
        const pb = await getImageBlob(p.imageId);
        if (!pb) throw new Error('全身照檔案遺失');
        setPhoto(await blobCanvas(pb));
        if (p.maskImageId) { const mb = await getImageBlob(p.maskImageId); if (mb) setMask(await blobCanvas(mb)); }
        setGarments(await listGarments());
      } catch (e) { setError((e as Error).message); }
    })();
  }, [personId]);

  // 網址指定的衣服改變時（例如從衣服頁或紀錄頁進入）同步選取
  useEffect(() => { if (garmentId) setSelected(garmentId); }, [garmentId]);

  // 選擇衣服
  useEffect(() => {
    const g = garments?.find((x) => x.id === selected);
    if (!g) { setLoaded(null); return; }
    let alive = true;
    setBusy('準備衣服');
    loadGarment(g).then((l) => { if (alive) { setLoaded(l); setAdjust(NO_ADJUST); setSavedId(null); } }, (e: Error) => setError(e.message)).finally(() => alive && setBusy(null));
    return () => { alive = false; };
  }, [selected, garments]);

  // 合成
  const compose = useCallback((draft: boolean) => {
    if (!photo || !person?.analysis || !loaded?.anchors) { setResult(null); return; }
    try {
      const r = composeTryOn({ photo, mask, analysis: person.analysis, layers: [{ id: loaded.garment.id, image: loaded.image, anchors: loaded.anchors, adjust }], draft, showAnchors });
      setResult(r);
      setError(null);
    } catch (e) { setError(`合成失敗：${(e as Error).message}`); }
  }, [photo, mask, person, loaded, adjust, showAnchors]);

  useEffect(() => {
    if (dragging) { compose(true); return; }
    const t = setTimeout(() => compose(false), 30);
    return () => clearTimeout(t);
  }, [compose, dragging]);

  // 顯示尺寸
  useEffect(() => {
    const el = wrap.current;
    if (!el || !photo) return;
    const fit = () => setScale(Math.min(el.clientWidth / photo.width, (innerHeight * 0.6) / photo.height));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [photo]);

  // 繪製（含前後比較）
  useEffect(() => {
    const c = view.current;
    if (!c || !photo) return;
    const dpr = devicePixelRatio;
    c.width = Math.round(photo.width * scale * dpr); c.height = Math.round(photo.height * scale * dpr);
    const x = ctx2d(c);
    x.imageSmoothingQuality = 'high';
    x.drawImage(result?.canvas ?? photo, 0, 0, c.width, c.height);
    if (mode === 'compare' && result) {
      const sx = c.width * split;
      x.save(); x.beginPath(); x.rect(0, 0, sx, c.height); x.clip();
      x.drawImage(photo, 0, 0, c.width, c.height); x.restore();
      x.fillStyle = '#fff'; x.fillRect(sx - 1.5 * dpr, 0, 3 * dpr, c.height);
      x.beginPath(); x.arc(sx, c.height / 2, 16 * dpr, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#111'; x.font = `600 ${12 * dpr}px -apple-system, sans-serif`; x.textAlign = 'center'; x.fillText('⇆', sx, c.height / 2 + 4 * dpr);
      x.textAlign = 'left'; x.fillStyle = 'rgba(0,0,0,.6)';
      x.fillRect(8 * dpr, 8 * dpr, 44 * dpr, 22 * dpr); x.fillRect(c.width - 52 * dpr, 8 * dpr, 44 * dpr, 22 * dpr);
      x.fillStyle = '#fff'; x.fillText('原圖', 15 * dpr, 23 * dpr); x.fillText('試穿', c.width - 45 * dpr, 23 * dpr);
    }
  }, [photo, result, scale, mode, split]);

  function down(e: React.PointerEvent) {
    if (!result) return;
    if (mode === 'compare') { drag.current = { x: e.clientX, y: 0, dx: 0, dy: 0, kind: 'split' }; move(e); }
    else if (mode === 'adjust') { drag.current = { x: e.clientX, y: e.clientY, dx: adjust.dx, dy: adjust.dy, kind: 'move' }; setDragging(true); }
    else return;
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'split') { const r = view.current!.getBoundingClientRect(); setSplit(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); }
    else setAdjust((a) => ({ ...a, dx: d.dx + (e.clientX - d.x) / scale, dy: d.dy + (e.clientY - d.y) / scale }));
  }
  function up() { drag.current = null; setDragging(false); }

  async function save() {
    if (!result || !loaded || !person) return;
    setBusy('儲存中');
    try {
      // 儲存時不畫錨點
      const clean = showAnchors && photo ? composeTryOn({ photo, mask, analysis: person.analysis!, layers: [{ id: loaded.garment.id, image: loaded.image, anchors: loaded.anchors!, adjust }] }).canvas : result.canvas;
      const t = await saveTryOn(person.id, [{ garmentId: loaded.garment.id, adjust }], clean);
      setSavedId(t.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function share() {
    if (!result) return;
    const blob = await new Promise<Blob | null>((r) => result.canvas.toBlob(r, 'image/jpeg', 0.9));
    if (blob) await saveFile(new File([blob], `AI試穿-${Date.now()}.jpg`, { type: 'image/jpeg' }));
  }

  const supported = useMemo(() => (garments ?? []).filter((g) => KIND_OF[g.category]), [garments]);
  const kind = loaded?.garment ? KIND_OF[loaded.garment.category] : undefined;
  const sliders: [keyof Adjust, string, number, number, number, (v: number) => string][] = [
    ['scale', '大小', 0.8, 1.25, 0.01, (v) => `${Math.round(v * 100)}%`],
    ['length', '長度', 0.75, 1.35, 0.01, (v) => `${Math.round(v * 100)}%`],
    ['rotate', '角度', -15, 15, 0.5, (v) => `${v.toFixed(1)}°`],
  ];

  return (
    <div className="page">
      <PageHeader title="AI 試穿" subtitle={person?.name} back="/tryon"
        right={person && <a className="icon-btn" aria-label="人體辨識結果" href={href(`/tryon/person/${person.id}`)}><Icon name="user" /></a>} />
      {error && <div className="alert alert-err" role="alert">{error}</div>}

      {photo && (
        <div ref={wrap} className="crop-wrap" style={{ position: 'relative' }}>
          <div className="cutout-stage" style={{ width: photo.width * scale, height: photo.height * scale }}>
            <canvas ref={view} style={{ width: '100%', height: '100%', touchAction: mode === 'result' ? 'auto' : 'none' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
            {busy && <div className="stage-busy"><span className="spinner" />{busy}</div>}
          </div>
        </div>
      )}

      {loaded && (
        <>
          <div className="segmented three" role="tablist">
            {([['result', '試穿'], ['compare', '前後比較'], ['adjust', '手動調整']] as const).map(([m, l]) => (
              <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{l}</button>
            ))}
          </div>
          {mode === 'compare' && <p className="editor-hint" style={{ marginTop: 8 }}>左右拖曳分隔線比較試穿前後</p>}
          {mode === 'adjust' && (
            <div className="card adjust">
              <p className="muted">在照片上拖曳可移動衣服</p>
              {sliders.map(([k, label, min, max, step, fmt]) => (
                <label key={k} className="slider">
                  <span>{label}</span>
                  <input type="range" min={min} max={max} step={step} value={adjust[k]} onPointerDown={() => setDragging(true)} onPointerUp={() => setDragging(false)} onChange={(e) => setAdjust((a) => ({ ...a, [k]: +e.target.value }))} />
                  <b>{fmt(adjust[k])}</b>
                </label>
              ))}
              <div className="row-between">
                <label className="inline-check"><input type="checkbox" checked={showAnchors} onChange={(e) => setShowAnchors(e.target.checked)} /> 顯示錨點</label>
                <button className="btn btn-small" onClick={() => setAdjust(NO_ADJUST)}>重設</button>
              </div>
            </div>
          )}
        </>
      )}

      <h3 className="section-title">選擇衣服{kind ? `：${KIND_ZH[kind]}` : ''}</h3>
      {garments && supported.length === 0 && (
        <EmptyState icon="hanger" title="衣櫥裡還沒有可試穿的衣服" action={<a className="btn btn-primary" href={href('/wardrobe/new')}>新增衣服</a>}>
          支援上衣、襯衫、外套、長褲、短褲、裙子、洋裝。
        </EmptyState>
      )}
      <div className="garment-strip">
        {supported.map((g) => <StripItem key={g.id} g={g} on={g.id === selected} onClick={() => setSelected(g.id)} />)}
      </div>

      {loaded && !loaded.cutout && <div className="alert alert-warn">這件衣服沒有去背，背景也會被貼上。建議到衣櫥「重新去背」。</div>}
      {loaded && !loaded.anchors && <div className="alert alert-err">無法辨識這件衣服的形狀，請確認去背結果。</div>}
      {result && result.notes.length > 0 && <ul className="checks card">{result.notes.map((n) => <li key={n} className="check-info"><span>i</span>{n}</li>)}</ul>}
      {person?.analysis?.checks.some((c) => c.level === 'error') && <div className="alert alert-warn">這張全身照有關鍵部位沒偵測到，試穿位置可能不準。可到「人體辨識結果」校正。</div>}

      {result && (
        <div className="row-2">
          <button className="btn btn-primary" disabled={!!busy || !!savedId} onClick={() => void save()}>{savedId ? '已儲存' : '儲存試穿'}</button>
          <button className="btn" onClick={() => void share()}><Icon name="share" size={18} /> 分享</button>
        </div>
      )}
      {savedId && <p className="muted center">已存到「穿搭收藏 → 歷史紀錄」 <a href={href('/outfits')}>查看</a></p>}
      {result && <p className="muted center">本機合成 {Math.round(result.ms)} ms</p>}
      <p className="disclaimer">說明：試穿圖是把衣服照片依身體關鍵點變形後合成的 2D 預覽（電腦視覺 + 圖像合成），不是生成式 AI；不會重建布料皺褶、光影與實際合身度，僅供搭配參考。</p>
    </div>
  );
}

function StripItem({ g, on, onClick }: { g: Garment; on: boolean; onClick: () => void }) {
  const url = useImageUrl(g.thumbImageId);
  return (
    <button className={`strip-item ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
      {url && <img src={url} alt="" />}
      <span>{g.name}</span>
    </button>
  );
}

export function goStudio(personId: string, garmentId?: string) {
  navigate(garmentId ? `/tryon/studio/${personId}/${garmentId}` : `/tryon/studio/${personId}`);
}
