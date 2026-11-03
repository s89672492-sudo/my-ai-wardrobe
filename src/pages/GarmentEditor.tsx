import { useEffect, useRef, useState } from 'react';
import { CropView } from '../components/CropView';
import { CutoutEditor } from '../components/CutoutEditor';
import { GarmentForm } from '../components/GarmentForm';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/ui';
import { createGarment, findDuplicate, getGarment, getImageBlob, updateGarment, type GarmentImages, type GarmentMeta } from '../lib/garments';
import { alphaBBox, canvasToBlob, ctx2d, decodeImageFile, guessColor, imageProfile, LIMITS, makeCanvas, makeThumbnail, sha256 } from '../lib/image';
import { getDB } from '../lib/db';
import { getStorageInfo } from '../lib/platform';
import { navigate } from '../lib/router';
import { CATEGORIES, type Garment } from '../lib/types';

type Step = 'pick' | 'crop' | 'cutout' | 'details';
const EMPTY: GarmentMeta = { name: '', category: 'tshirt', color: '', brand: '', size: '', seasons: [], notes: '', favorite: 0, styles: [] };

export function GarmentEditor({ id }: { id?: string }) {
  const [step, setStep] = useState<Step>(id ? 'details' : 'pick');
  const [meta, setMeta] = useState<GarmentMeta>(EMPTY);
  const [existing, setExisting] = useState<Garment | null>(null);
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [cropped, setCropped] = useState<HTMLCanvasElement | null>(null);
  const [images, setImages] = useState<Partial<GarmentImages> | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dupe, setDupe] = useState<Garment | null>(null);
  const hash = useRef('');
  const metaTouched = useRef(false);

  useEffect(() => {
    if (!id) return;
    void getGarment(id).then(async (g) => {
      if (!g) { setError('找不到這件衣服，可能已被刪除'); return; }
      setExisting(g);
      setMeta({ name: g.name, category: g.category, color: g.color, brand: g.brand, size: g.size, seasons: g.seasons, notes: g.notes, favorite: g.favorite, styles: g.styles ?? [] });
      metaTouched.current = true;
      const b = await getImageBlob(g.thumbImageId);
      if (b) setPreview(URL.createObjectURL(b));
    });
  }, [id]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy('讀取照片');
    try {
      hash.current = await sha256(file);
      const d = await findDuplicate(hash.current);
      if (d && d.id !== id) setDupe(d);
      const bmp = await decodeImageFile(file, imageProfile().originalMaxSide);
      const c = makeCanvas(bmp.width, bmp.height);
      ctx2d(c).drawImage(bmp, 0, 0);
      bmp.close();
      setSource(c);
      setStep('crop');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function finishCutout(work: HTMLCanvasElement, mask: HTMLCanvasElement | null) {
    setBusy('產生圖片');
    setError(null);
    try {
      const orig = cropped!;
      const original = { blob: await canvasToBlob(orig, 'image/jpeg', imageProfile().jpegQ), width: orig.width, height: orig.height, hash: hash.current };
      let cutout: GarmentImages['cutout'] = null;
      let thumbSrc: HTMLCanvasElement = work;
      if (mask) {
        const full = makeCanvas(work.width, work.height);
        const x = ctx2d(full, { willReadFrequently: true });
        x.drawImage(work, 0, 0);
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(mask, 0, 0);
        const data = x.getImageData(0, 0, full.width, full.height).data;
        const bb = alphaBBox(data, full.width, full.height);
        if (!bb) throw new Error('去背後沒有留下任何內容，請回上一步重新點選衣服');
        const pad = Math.round(Math.max(bb.w, bb.h) * 0.02);
        const sx = Math.max(0, bb.x - pad), sy = Math.max(0, bb.y - pad);
        const out = makeCanvas(Math.min(full.width - sx, bb.w + 2 * pad), Math.min(full.height - sy, bb.h + 2 * pad));
        ctx2d(out).drawImage(full, sx, sy, out.width, out.height, 0, 0, out.width, out.height);
        cutout = { blob: await canvasToBlob(out, 'image/png'), width: out.width, height: out.height };
        thumbSrc = out;
        const guess = guessColor(data);
        setMeta((m) => (m.color ? m : { ...m, color: guess }));
      }
      const tb = await makeThumbnail(thumbSrc);
      setImages({ original, cutout, thumb: { blob: tb, width: LIMITS.thumbSide, height: Math.round(LIMITS.thumbSide * 4 / 3) } });
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(tb));
      setStep('details');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function redoCutout() {
    if (!existing) return;
    setBusy('讀取原圖');
    try {
      const b = await getImageBlob(existing.originalImageId);
      if (!b) throw new Error('找不到原始圖片');
      const bmp = await createImageBitmap(b);
      const c = makeCanvas(bmp.width, bmp.height);
      ctx2d(c).drawImage(bmp, 0, 0);
      bmp.close();
      hash.current = (await (await getDB()).get('images', existing.originalImageId))?.hash ?? '';
      setCropped(c);
      setStep('cutout');
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function save() {
    setError(null);
    const m = { ...meta, name: meta.name.trim() || `${meta.color}${CATEGORIES.find((c) => c.id === meta.category)?.label ?? ''}` };
    setBusy('儲存中');
    try {
      const st = await getStorageInfo();
      if (st && st.quotaMB - st.usageMB < 30) throw new Error(`手機剩餘可用空間不足（約 ${Math.max(0, st.quotaMB - st.usageMB).toFixed(0)} MB），請先刪除部分資料或匯出備份。`);
      let g: Garment;
      if (existing) g = await updateGarment(existing.id, m, images ?? undefined);
      else {
        if (!images?.original || !images.thumb) throw new Error('請先選擇照片');
        g = await createGarment(m, images as GarmentImages);
      }
      navigate(`/wardrobe/item/${g.id}`, true);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  function cancel() {
    if (step !== 'pick' && !confirm('尚未儲存，確定要離開嗎？')) return;
    history.back();
  }

  const title = existing ? '編輯衣服' : '新增衣服';
  const stepNo = { pick: 1, crop: 2, cutout: 3, details: 4 }[step];
  return (
    <div className="page">
      <PageHeader title={title} subtitle={existing && step === 'details' ? undefined : `步驟 ${stepNo} / 4`} right={<button className="icon-btn" aria-label="取消" onClick={cancel}><Icon name="close" /></button>} />
      {error && <div className="alert alert-err" role="alert">{error}</div>}
      {dupe && (
        <div className="alert alert-warn">
          這張照片可能已經新增過（「{dupe.name}」）。仍要繼續嗎？
          <button className="btn btn-small" onClick={() => setDupe(null)}>繼續</button>{' '}
          <a className="btn btn-small" href={`#/wardrobe/item/${dupe.id}`}>查看那件</a>
        </div>
      )}

      {step === 'pick' && (
        <div className="pick">
          <label className="pick-btn">
            <Icon name="camera" size={34} /><b>拍照</b><span>把衣服平放或掛起來拍</span>
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <label className="pick-btn">
            <Icon name="image" size={34} /><b>從相簿選擇</b><span>支援 JPEG、PNG、HEIC</span>
            <input type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <ul className="tips">
            <li>背景越單純，去背越準確</li>
            <li>衣服攤平、整件入鏡，光線充足</li>
            <li>照片只在這支手機處理，不會上傳</li>
          </ul>
          {busy && <p className="muted center"><span className="spinner" /> {busy}</p>}
        </div>
      )}

      {step === 'crop' && source && <CropView source={source} onBack={() => setStep('pick')} onDone={(c) => { setCropped(c); setStep('cutout'); }} />}

      {step === 'cutout' && cropped && (
        <CutoutEditor source={cropped} onBack={() => setStep(existing ? 'details' : 'crop')} onDone={(w, m) => void finishCutout(w, m)} onSkip={(w) => void finishCutout(w, null)} />
      )}

      {step === 'details' && (
        <>
          <div className="detail-preview">
            {preview ? <img src={preview} alt="衣服預覽" /> : <div className="garment-img" />}
          </div>
          {existing && (
            <div className="row-2">
              <button className="btn" disabled={!!busy} onClick={() => void redoCutout()}><Icon name="eraser" size={18} /> 重新去背</button>
              <button className="btn" disabled={!!busy} onClick={() => setStep('pick')}><Icon name="camera" size={18} /> 更換照片</button>
            </div>
          )}
          {images && !images.cutout && <p className="muted">此衣服未去背，AI 試穿時效果會較差。</p>}
          <GarmentForm value={meta} onChange={(v) => { metaTouched.current = true; setMeta(v); }} />
          <div className="sticky-actions">
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void save()}>{busy ?? '儲存'}</button>
          </div>
        </>
      )}
    </div>
  );
}

