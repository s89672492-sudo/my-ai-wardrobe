import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { EmptyState, PageHeader } from '../components/ui';
import { saveFile } from '../lib/backup';
import { getImageBlob, listGarments } from '../lib/garments';
import { ctx2d, makeCanvas } from '../lib/image';
import { getOutfit, saveOutfit } from '../lib/outfits';
import { getPerson } from '../lib/persons';
import { href } from '../lib/router';
import { saveTryOn } from '../lib/tryons';
import type { Garment, PersonPhoto, TryOnLayerRecord } from '../lib/types';
import { useImageUrl } from '../lib/useImageUrl';
import { NO_ADJUST, type Adjust } from '../tryon/bodyTargets';
import { composeTryOn, releaseComposeMemory, type Layer } from '../tryon/compose';
import { perfFor } from '../lib/compute';
import { useSettings } from '../lib/settings';
import { detectAnchors, KIND_OF, type GarmentAnchors, type TryOnKind } from '../tryon/garmentAnchors';
import { DEFAULT_OPTIONS, planLayers, selectInto, SLOT_OF, SLOT_ZH, type OutfitOptions, type Slot } from '../tryon/outfit';

type Mode = 'result' | 'compare' | 'adjust';
interface Loaded { garment: Garment; image: HTMLCanvasElement; anchors: GarmentAnchors | null; cutout: boolean }
type Picked = Partial<Record<Slot, Loaded>>;
const GARMENT_MAX = 900;
const SLOT_ORDER: Slot[] = ['outer', 'top', 'dress', 'bottom']; // 面板由上（外層）到下

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

const cache = new Map<string, Promise<Loaded>>();
function loadGarment(g: Garment): Promise<Loaded> {
  const key = `${g.id}:${g.updatedAt}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const b = await getImageBlob(g.cutoutImageId ?? g.originalImageId);
      if (!b) throw new Error(`找不到「${g.name}」的圖片`);
      const image = await blobCanvas(b, GARMENT_MAX);
      const kind = KIND_OF[g.category];
      const data = ctx2d(image, { willReadFrequently: true }).getImageData(0, 0, image.width, image.height).data;
      return { garment: g, image, anchors: kind ? detectAnchors(data, image.width, image.height, kind) : null, cutout: !!g.cutoutImageId };
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function TryOnStudio({ personId, garmentId, outfitId, garmentIds }: { personId: string; garmentId?: string; outfitId?: string; garmentIds?: string[] }) {
  const [person, setPerson] = useState<PersonPhoto | null>(null);
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null);
  const [garments, setGarments] = useState<Garment[] | null>(null);
  const [picked, setPicked] = useState<Picked>({});
  const [adjusts, setAdjusts] = useState<Partial<Record<Slot, Adjust>>>({});
  const [hidden, setHidden] = useState<Set<Slot>>(new Set());
  const [options, setOptions] = useState<OutfitOptions>(DEFAULT_OPTIONS);
  const [active, setActive] = useState<Slot | null>(null);
  const [filter, setFilter] = useState<Slot | 'all'>('all');
  const [mode, setMode] = useState<Mode>('result');
  const [split, setSplit] = useState(0.5);
  const [showAnchors, setShowAnchors] = useState(false);
  const [result, setResult] = useState<{ canvas: HTMLCanvasElement; notes: string[]; ms: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ tryOnId?: string; outfitId?: string }>({});
  const view = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; kind: 'move' | 'split'; slot?: Slot } | null>(null);
  const [dragging, setDragging] = useState(false);

  const { settings } = useSettings();
  const perf = useMemo(() => perfFor(settings), [settings]);
  const lastDraft = useRef(0);
  useEffect(() => () => releaseComposeMemory(), []);
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast((x) => (x === t ? null : x)), 2600); };
  const dirty = () => setSaved({});

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

  const add = useCallback(async (g: Garment, adj?: Adjust) => {
    const kind = KIND_OF[g.category];
    if (!kind) return;
    const slot = SLOT_OF[kind];
    setBusy('準備衣服');
    try {
      const l = await loadGarment(g);
      setPicked((cur) => {
        const { next, removed } = selectInto(cur, slot, l);
        if (removed.length) flash(`洋裝不能和${slot === 'dress' ? removed.map((s) => SLOT_ZH[s]).join('、') : '洋裝'}同時穿，已替換`);
        return next;
      });
      setAdjusts((a) => ({ ...a, [slot]: adj ?? NO_ADJUST }));
      setHidden((h) => { const n = new Set(h); n.delete(slot); return n; });
      setActive(slot);
      dirty();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }, []);

  // 網址指定的衣服或穿搭
  useEffect(() => {
    if (!garments) return;
    if (garmentId) { const g = garments.find((x) => x.id === garmentId); if (g) void add(g); }
    if (garmentIds) void (async () => { for (const id of garmentIds) { const g = garments.find((x) => x.id === id); if (g && KIND_OF[g.category]) await add(g); } })();
    if (outfitId) void (async () => {
      const o = await getOutfit(outfitId);
      if (!o) return setError('找不到這套穿搭');
      setOptions(o.options ?? DEFAULT_OPTIONS);
      const missing: string[] = [];
      for (const id of o.garmentIds) {
        const g = garments.find((x) => x.id === id);
        if (!g) { missing.push(id); continue; }
        await add(g, o.layers?.find((l) => l.garmentId === id)?.adjust);
      }
      if (missing.length) flash(`有 ${missing.length} 件衣服已從衣櫥刪除`);
    })();
  }, [garments, garmentId, outfitId, garmentIds, add]);

  function remove(slot: Slot) {
    setPicked((p) => { const n = { ...p }; delete n[slot]; return n; });
    if (active === slot) setActive(null);
    dirty();
  }

  const layers = useMemo((): Layer[] => {
    const kinds: Partial<Record<Slot, TryOnKind>> = {};
    for (const [s, l] of Object.entries(picked) as [Slot, Loaded][]) kinds[s] = KIND_OF[l.garment.category];
    return planLayers(kinds, options).flatMap((pl) => {
      const l = picked[pl.slot];
      if (!l?.anchors || hidden.has(pl.slot)) return [];
      return [{ id: pl.slot, image: l.image, anchors: l.anchors, adjust: adjusts[pl.slot] ?? NO_ADJUST, z: pl.z, cutBelowT: pl.cutBelowT, openFront: pl.openFront }];
    });
  }, [picked, adjusts, hidden, options]);

  const compose = useCallback((draft: boolean, anchorsOn = showAnchors) => {
    if (!photo || !person?.analysis || !layers.length) { setResult(null); return null; }
    try {
      const r = composeTryOn({ photo, mask, analysis: person.analysis, layers, draft, showAnchors: anchorsOn, grid: perf.grid, draftGrid: perf.draftGrid });
      setResult(r);
      setError(null);
      return r;
    } catch (e) { setError(`合成失敗：${(e as Error).message}`); return null; }
  }, [photo, mask, person, layers, showAnchors, perf]);

  useEffect(() => {
    if (dragging) {
      // 省電模式降低拖曳預覽頻率
      const wait = perf.draftIntervalMs - (performance.now() - lastDraft.current);
      if (wait <= 0) { lastDraft.current = performance.now(); compose(true); return; }
      const t = setTimeout(() => { lastDraft.current = performance.now(); compose(true); }, wait);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => compose(false), 30);
    return () => clearTimeout(t);
  }, [compose, dragging, perf]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !photo) return;
    const fit = () => setScale(Math.min(el.clientWidth / photo.width, (innerHeight * 0.6) / photo.height));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [photo]);

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

  const activeAdjust = (active && adjusts[active]) || NO_ADJUST;
  const setActiveAdjust = (f: (a: Adjust) => Adjust) => { if (!active) return; setAdjusts((all) => ({ ...all, [active]: f(all[active] ?? NO_ADJUST) })); dirty(); };

  function down(e: React.PointerEvent) {
    if (!result) return;
    if (mode === 'compare') { drag.current = { x: e.clientX, y: 0, dx: 0, dy: 0, kind: 'split' }; move(e); }
    else if (mode === 'adjust' && active) { drag.current = { x: e.clientX, y: e.clientY, dx: activeAdjust.dx, dy: activeAdjust.dy, kind: 'move' }; setDragging(true); }
    else return;
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'split') { const r = view.current!.getBoundingClientRect(); setSplit(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); }
    else setActiveAdjust((a) => ({ ...a, dx: d.dx + (e.clientX - d.x) / scale, dy: d.dy + (e.clientY - d.y) / scale }));
  }
  function up() { drag.current = null; setDragging(false); }

  const records = (): TryOnLayerRecord[] => Object.entries(picked).map(([s, l]) => ({ garmentId: l!.garment.id, adjust: adjusts[s as Slot] ?? NO_ADJUST }));
  /** 儲存用的乾淨圖（不含錨點） */
  const cleanCanvas = () => (showAnchors ? compose(false, false)?.canvas : result?.canvas) ?? null;

  async function saveResult(): Promise<string | null> {
    if (saved.tryOnId) return saved.tryOnId;
    const c = cleanCanvas();
    if (!c || !person) return null;
    const t = await saveTryOn(person.id, records(), c, options);
    setSaved((s) => ({ ...s, tryOnId: t.id }));
    if (showAnchors) compose(false);
    return t.id;
  }
  async function save() {
    setBusy('儲存中');
    try { await saveResult(); flash('已存到試穿紀錄'); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function favorite() {
    if (!person) return;
    const names = Object.values(picked).map((l) => l!.garment.name);
    const name = prompt('為這套穿搭取個名字', names.join(' + '))?.trim();
    if (name === undefined) return;
    setBusy('收藏中');
    try {
      const tid = await saveResult();
      const { listTryOns } = await import('../lib/tryons');
      const t = (await listTryOns()).find((x) => x.id === tid);
      const o = await saveOutfit({ name: name || names.join(' + '), garmentIds: records().map((r) => r.garmentId), tags: [], options, layers: records(), tryOnId: tid ?? undefined, personId: person.id, previewImageId: t?.thumbImageId, source: 'tryon' });
      setSaved((s) => ({ ...s, outfitId: o.id }));
      flash('已加入穿搭收藏');
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function share() {
    const c = cleanCanvas();
    if (!c) return;
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
    if (blob) await saveFile(new File([blob], `ai-tryon-${Date.now()}.jpg`, { type: 'image/jpeg' }));
  }

  const supported = useMemo(() => (garments ?? []).filter((g) => { const k = KIND_OF[g.category]; return k && (filter === 'all' || SLOT_OF[k] === filter); }), [garments, filter]);
  const pickedIds = new Set(Object.values(picked).map((l) => l!.garment.id));
  const slots = SLOT_ORDER.filter((s) => picked[s]);
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
      {toast && <div className="inline-toast" role="status">{toast}</div>}

      {slots.length > 0 && (
        <>
          <div className="segmented three" role="tablist">
            {([['result', '試穿'], ['compare', '前後比較'], ['adjust', '手動調整']] as const).map(([m, l]) => (
              <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{l}</button>
            ))}
          </div>
          {mode === 'compare' && <p className="editor-hint" style={{ marginTop: 8 }}>左右拖曳分隔線比較試穿前後</p>}
          {mode === 'adjust' && (
            <div className="card adjust">
              <div className="chips tight" role="tablist" aria-label="要調整的衣服">
                {slots.map((s) => <button key={s} role="tab" aria-selected={active === s} className={active === s ? 'chip on' : 'chip'} onClick={() => setActive(s)}>{SLOT_ZH[s]}</button>)}
              </div>
              {active && picked[active] ? (
                <>
                  <p className="muted">調整「{picked[active]!.garment.name}」：在照片上拖曳可移動</p>
                  {sliders.map(([k, label, min, max, step, fmt]) => (
                    <label key={k} className="slider">
                      <span>{label}</span>
                      <input type="range" min={min} max={max} step={step} value={activeAdjust[k]} onPointerDown={() => setDragging(true)} onPointerUp={() => setDragging(false)} onChange={(e) => setActiveAdjust((a) => ({ ...a, [k]: +e.target.value }))} />
                      <b>{fmt(activeAdjust[k])}</b>
                    </label>
                  ))}
                  <div className="row-between">
                    <label className="inline-check"><input type="checkbox" checked={showAnchors} onChange={(e) => setShowAnchors(e.target.checked)} /> 顯示錨點</label>
                    <button className="btn btn-small" onClick={() => setActiveAdjust(() => NO_ADJUST)}>重設這件</button>
                  </div>
                </>
              ) : <p className="muted">先選擇要調整的衣服</p>}
            </div>
          )}

          <h3 className="section-title">穿搭圖層（由外到內）</h3>
          <ul className="layers card">
            {slots.map((s) => <LayerRow key={s} slot={s} l={picked[s]!} hidden={hidden.has(s)} onToggle={() => setHidden((h) => { const n = new Set(h); if (n.has(s)) n.delete(s); else n.add(s); return n; })} onRemove={() => remove(s)} />)}
            <li className="layer-person"><Icon name="user" size={18} /> 人物照片</li>
          </ul>
          {(picked.top && picked.bottom) || picked.outer ? (
            <div className="card">
              {picked.top && picked.bottom && (
                <label className="option toggle"><span><b>上衣紮進{SLOT_ZH.bottom}</b><small>{options.tucked ? '下身蓋住上衣下襬' : '上衣蓋住腰頭'}</small></span>
                  <input type="checkbox" role="switch" checked={options.tucked} onChange={(e) => { setOptions((o) => ({ ...o, tucked: e.target.checked })); dirty(); }} /></label>
              )}
              {picked.outer && (
                <label className="option toggle"><span><b>外套敞開</b><small>露出裡面的衣服</small></span>
                  <input type="checkbox" role="switch" checked={options.openFront} onChange={(e) => { setOptions((o) => ({ ...o, openFront: e.target.checked })); dirty(); }} /></label>
              )}
            </div>
          ) : null}
        </>
      )}

      <h3 className="section-title">選擇衣服（點同一件可取消）</h3>
      <div className="chips tight" role="tablist" aria-label="衣服種類">
        {(['all', 'top', 'bottom', 'outer', 'dress'] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'chip on' : 'chip'} onClick={() => setFilter(f)}>{f === 'all' ? '全部' : SLOT_ZH[f]}</button>
        ))}
      </div>
      {garments && supported.length === 0 && (
        <EmptyState icon="hanger" title={filter === 'all' ? '衣櫥裡還沒有可試穿的衣服' : `沒有${SLOT_ZH[filter]}`} action={<a className="btn btn-primary" href={href('/wardrobe/new')}>新增衣服</a>}>
          支援上衣、襯衫、外套、長褲、短褲、裙子、洋裝。
        </EmptyState>
      )}
      <div className="garment-strip">
        {supported.map((g) => <StripItem key={g.id} g={g} on={pickedIds.has(g.id)} onClick={() => { const k = KIND_OF[g.category]!; if (pickedIds.has(g.id)) remove(SLOT_OF[k]); else void add(g); }} />)}
      </div>

      {Object.values(picked).some((l) => !l!.cutout) && <div className="alert alert-warn">有衣服沒有去背，背景也會被貼上。建議到衣櫥「重新去背」。</div>}
      {Object.values(picked).some((l) => !l!.anchors) && <div className="alert alert-err">有衣服無法辨識形狀，請確認去背結果。</div>}
      {result && result.notes.length > 0 && <ul className="checks card">{result.notes.map((n) => <li key={n} className="check-info"><span>i</span>{n}</li>)}</ul>}
      {person?.analysis?.checks.some((c) => c.level === 'error') && <div className="alert alert-warn">這張全身照有關鍵部位沒偵測到，試穿位置可能不準。可到「人體辨識結果」校正。</div>}

      {result && (
        <>
          <div className="row-2">
            <button className="btn btn-primary" disabled={!!busy || !!saved.tryOnId} onClick={() => void save()}>{saved.tryOnId ? '已儲存' : '儲存試穿'}</button>
            <button className="btn" disabled={!!busy || !!saved.outfitId || slots.length < 1} onClick={() => void favorite()}><Icon name="heart" size={18} filled={!!saved.outfitId} /> {saved.outfitId ? '已收藏' : '收藏穿搭'}</button>
          </div>
          <button className="btn" onClick={() => void share()}><Icon name="share" size={18} /> 分享圖片</button>
          <p className="muted center">本機合成 {Math.round(result.ms)} ms · {layers.length} 件</p>
        </>
      )}
      <p className="disclaimer">說明：試穿圖是把衣服照片依身體關鍵點變形後合成的 2D 預覽（電腦視覺 + 圖像合成），不是生成式 AI；不會重建布料皺褶、光影與實際合身度，僅供搭配參考。</p>
    </div>
  );
}

function LayerRow({ slot, l, hidden, onToggle, onRemove }: { slot: Slot; l: Loaded; hidden: boolean; onToggle: () => void; onRemove: () => void }) {
  const url = useImageUrl(l.garment.thumbImageId);
  return (
    <li className={hidden ? 'off' : ''}>
      {url ? <img src={url} alt="" /> : <span className="ph" />}
      <span className="layer-text"><small>{SLOT_ZH[slot]}</small>{l.garment.name}</span>
      <button className="icon-btn small" aria-label={hidden ? '顯示' : '隱藏'} onClick={onToggle}>{hidden ? '◌' : '●'}</button>
      <button className="icon-btn small" aria-label="移除" onClick={onRemove}><Icon name="close" size={16} /></button>
    </li>
  );
}

function StripItem({ g, on, onClick }: { g: Garment; on: boolean; onClick: () => void }) {
  const url = useImageUrl(g.thumbImageId);
  return (
    <button className={`strip-item ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
      {url && <img src={url} alt="" />}
      {on && <span className="strip-check">✓</span>}
      <span>{g.name}</span>
    </button>
  );
}
