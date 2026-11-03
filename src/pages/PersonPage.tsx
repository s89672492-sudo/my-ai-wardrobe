import { useEffect, useRef, useState } from 'react';
import { analyzeBody, type BodyAnalysis, type MaskData } from '../ai/body';
import { analyzePhoto, cancelAnalyze, ensureBodyModels, releaseBodyModels } from '../ai/body-client';
import { KEYPOINT_NAMES, type Keypoint } from '../ai/protocol';
import { BodyView, type Layers } from '../components/BodyView';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/ui';
import { acceleratorFor, maxSideFor, resolveMode } from '../lib/compute';
import { getImageBlob } from '../lib/garments';
import { canvasToBlob, ctx2d, decodeImageFile, imageProfile, makeCanvas, makeThumbnail } from '../lib/image';
import { deletePerson, getPerson, savePerson } from '../lib/persons';
import { navigate } from '../lib/router';
import { useSettings } from '../lib/settings';
import type { PersonPhoto } from '../lib/types';

const ARM_ZH = { side: '在身側', front: '在身體前方', akimbo: '叉腰', raised: '舉起', unknown: '無法判斷' } as const;
const FACING_ZH = { front: '正面', back: '背面／左右相反', side: '側身', unknown: '無法判斷' } as const;
const LEVEL_ICON = { ok: '✓', info: 'i', warn: '!', error: '✕' } as const;

function maskDataOf(c: HTMLCanvasElement, rect: BodyAnalysis['maskRect']): MaskData {
  return { data: ctx2d(c, { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height, rect };
}

export function PersonPage({ id }: { id?: string }) {
  const { settings } = useSettings();
  const [person, setPerson] = useState<PersonPhoto | null>(null);
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null);
  const [analysis, setAnalysis] = useState<BodyAnalysis | null>(null);
  const [layers, setLayers] = useState<Layers>({ mask: true, arms: true, skeleton: true, measures: false });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [dirty, setDirty] = useState({ photo: false, mask: false, analysis: false });
  const [corrected, setCorrected] = useState(false);
  const [name, setName] = useState('');
  const hash = useRef('');

  useEffect(() => () => { void releaseBodyModels(); }, []);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const p = await getPerson(id);
        if (!p) throw new Error('找不到這張全身照，可能已被刪除');
        setPerson(p); setName(p.name); setCorrected(p.corrected);
        const pb = await getImageBlob(p.imageId);
        if (!pb) throw new Error('照片檔案遺失');
        setPhoto(await blobToCanvas(pb));
        if (p.maskImageId) { const mb = await getImageBlob(p.maskImageId); if (mb) setMask(await blobToCanvas(mb)); }
        setAnalysis(p.analysis);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [id]);

  async function run(c: HTMLCanvasElement) {
    setError(null);
    setEditing(false);
    try {
      const be = await ensureBodyModels(acceleratorFor(settings), (s) => setBusy(s));
      setBackend(be === 'webgpu' ? 'WebGPU' : 'CPU');
      setBusy('AI 人體辨識中');
      const out = await analyzePhoto(await createImageBitmap(c), (s) => setBusy(s));
      const m = makeCanvas(out.mask.width, out.mask.height);
      ctx2d(m).drawImage(out.mask, 0, 0);
      out.mask.close();
      setMask(m);
      setAnalysis(analyzeBody(out.keypoints, c.width, c.height, maskDataOf(m, out.maskRect)));
      setMs(out.ms);
      setCorrected(false);
      setDirty((d) => ({ ...d, mask: true, analysis: true }));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== '已取消') setError(`AI 人體辨識失敗：${msg}`);
    } finally { setBusy(null); }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy('讀取照片');
    try {
      const bmp = await decodeImageFile(file, maxSideFor(settings));
      const c = makeCanvas(bmp.width, bmp.height);
      ctx2d(c).drawImage(bmp, 0, 0);
      bmp.close();
      hash.current = `${file.size}-${file.lastModified}`;
      setPhoto(c);
      setAnalysis(null); setMask(null);
      setDirty({ photo: true, mask: true, analysis: true });
      await run(c);
    } catch (e) { setError((e as Error).message); setBusy(null); }
  }

  function applyKeypoints(kp: Keypoint[]) {
    if (!photo || !analysis) return;
    setAnalysis(analyzeBody(kp, photo.width, photo.height, mask ? maskDataOf(mask, analysis.maskRect) : null));
    setCorrected(true);
    setDirty((d) => ({ ...d, analysis: true }));
  }

  /** 人物左右對調（鏡像自拍或 AI 左右判斷錯誤時） */
  function swapLR() {
    if (!analysis) return;
    const kp = analysis.keypoints;
    const swapped = KEYPOINT_NAMES.map((n, i) => {
      const other = n.startsWith('left_') ? n.replace('left_', 'right_') : n.startsWith('right_') ? n.replace('right_', 'left_') : n;
      const j = KEYPOINT_NAMES.indexOf(other as (typeof KEYPOINT_NAMES)[number]);
      return { ...kp[j]!, name: kp[i]!.name };
    });
    applyKeypoints(swapped);
  }

  /** 依身體中軸角度旋轉照片，讓身體垂直，再重新辨識 */
  async function straighten() {
    if (!photo || !analysis) return;
    const a = (-analysis.measures.tiltDeg * Math.PI) / 180;
    const w = photo.width, h = photo.height;
    const W = Math.round(Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))), H = Math.round(Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)));
    const c = makeCanvas(W, H);
    const x = ctx2d(c);
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    x.translate(W / 2, H / 2); x.rotate(a); x.drawImage(photo, -w / 2, -h / 2);
    setPhoto(c);
    setDirty({ photo: true, mask: true, analysis: true });
    await run(c);
  }

  async function save() {
    if (!photo) return;
    setBusy('儲存中');
    setError(null);
    try {
      const nm = name.trim() || `全身照 ${new Date().toLocaleDateString('zh-TW')}`;
      const tb = await makeThumbnail(photo);
      const p = await savePerson({
        id: person?.id, name: nm, analysis, corrected,
        photo: dirty.photo ? { blob: await canvasToBlob(photo, 'image/jpeg', imageProfile().jpegQ), width: photo.width, height: photo.height, hash: hash.current } : undefined,
        thumb: dirty.photo ? { blob: tb, width: 480, height: 640 } : undefined,
        mask: dirty.mask ? (mask ? { blob: await canvasToBlob(mask, 'image/png'), width: mask.width, height: mask.height } : null) : undefined,
      });
      setPerson(p);
      setDirty({ photo: false, mask: false, analysis: false });
      if (!id) navigate(`/tryon/person/${p.id}`, true);
      else setBusy(null);
    } catch (e) { setError((e as Error).message); setBusy(null); }
  }

  async function del() {
    if (!person || !confirm('確定要刪除這張全身照嗎？')) return;
    await deletePerson(person.id);
    navigate('/tryon', true);
  }

  const unsaved = dirty.photo || dirty.analysis || dirty.mask;
  const toggle = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const m = analysis?.measures;

  return (
    <div className="page">
      <PageHeader title={id ? (person?.name ?? '全身照') : '新增全身照'} subtitle="AI 人體辨識" back="/tryon" />
      {error && <div className="alert alert-err" role="alert">{error}</div>}

      {!photo && !id && (
        <div className="pick">
          <label className="pick-btn"><Icon name="camera" size={34} /><b>拍照</b><span>請別人幫忙拍，或用自拍架</span>
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <label className="pick-btn"><Icon name="image" size={34} /><b>從相簿選擇</b><span>正面、全身入鏡的照片</span>
            <input type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <ul className="tips">
            <li>正面站立，頭到腳都在畫面內</li>
            <li>穿貼身一點的衣服，手臂稍微離開身體</li>
            <li>背景單純、光線均勻，畫面中只有你一個人</li>
            <li>照片只在這支手機處理（目前：{{ high: '高品質', balanced: '平衡', saver: '省電' }[resolveMode(settings)]}模式，上限 {maxSideFor(settings)}px）</li>
          </ul>
          {busy && <p className="muted center"><span className="spinner" /> {busy}</p>}
        </div>
      )}

      {photo && (
        <>
          <div style={{ position: 'relative' }}>
            <BodyView photo={photo} mask={mask} analysis={analysis} layers={layers} editing={editing} onEdit={applyKeypoints} />
            {busy && <div className="stage-busy"><span className="spinner" />{busy}<button className="btn btn-small" onClick={cancelAnalyze}>取消</button></div>}
          </div>
          {editing ? (
            <p className="editor-hint" style={{ marginTop: 10 }}>拖曳紅點到正確的關節位置，完成後點「完成校正」</p>
          ) : (
            <div className="chips layer-chips">
              {([['mask', '人體輪廓'], ['arms', '手臂遮擋'], ['skeleton', '骨架'], ['measures', '寬度量測']] as const).map(([k, l]) => (
                <button key={k} className={layers[k] ? 'chip on' : 'chip'} onClick={() => toggle(k)}>{l}</button>
              ))}
            </div>
          )}
          {analysis && (
            <div className="row-2">
              <button className={`btn ${editing ? 'btn-primary' : ''}`} disabled={!!busy} onClick={() => { if (!editing) window.scrollTo({ top: 0, behavior: 'smooth' }); setEditing(!editing); }}><Icon name="tap" size={18} /> {editing ? '完成校正' : '校正關鍵點'}</button>
              <button className="btn" disabled={!!busy} onClick={() => void run(photo)}><Icon name="rotate" size={18} /> 重新辨識</button>
            </div>
          )}
          {analysis && (analysis.facing === 'back' || Math.abs(analysis.measures.tiltDeg) > 3) && (
            <div className="row-2">
              {analysis.facing === 'back' && <button className="btn" onClick={swapLR}>左右對調</button>}
              {Math.abs(analysis.measures.tiltDeg) > 3 && <button className="btn" disabled={!!busy} onClick={() => void straighten()}>自動轉正 {Math.abs(analysis.measures.tiltDeg).toFixed(0)}°</button>}
            </div>
          )}

          {analysis && (
            <>
              <h3 className="section-title">辨識結果</h3>
              <ul className="checks card">
                {analysis.checks.map((c) => <li key={c.id} className={`check-${c.level}`}><span>{LEVEL_ICON[c.level]}</span>{c.text}</li>)}
              </ul>
              <div className="card">
                <dl className="specs tight">
                  <dt>朝向</dt><dd>{FACING_ZH[analysis.facing]}</dd>
                  <dt>左手</dt><dd>{ARM_ZH[analysis.arms.left]}</dd>
                  <dt>右手</dt><dd>{ARM_ZH[analysis.arms.right]}</dd>
                  <dt>身體傾斜</dt><dd>{m!.tiltDeg.toFixed(1)}°（肩線 {m!.shoulderTiltDeg.toFixed(1)}°、臀線 {m!.hipTiltDeg.toFixed(1)}°）</dd>
                  <dt>肩寬</dt><dd>{m!.shoulderWidth.toFixed(0)} px</dd>
                  <dt>腰寬</dt><dd>{m!.waistWidth.toFixed(0)} px（肩寬的 {((m!.waistWidth / m!.shoulderWidth) * 100).toFixed(0)}%）</dd>
                  <dt>臀寬</dt><dd>{m!.hipWidth.toFixed(0)} px（肩寬的 {((m!.hipWidth / m!.shoulderWidth) * 100).toFixed(0)}%）</dd>
                  <dt>寬度來源</dt><dd>{m!.widthsFromMask ? '人體輪廓實際量測' : '由關鍵點推估'}</dd>
                  <dt>軀幹長</dt><dd>{m!.torsoLength.toFixed(0)} px</dd>
                  <dt>腿長</dt><dd>{m!.legLength ? `${m!.legLength.toFixed(0)} px` : '—'}</dd>
                  {ms !== null && <><dt>辨識時間</dt><dd>{ms.toFixed(0)} ms（{backend}，本機運算）</dd></>}
                  {corrected && <><dt>手動校正</dt><dd>是</dd></>}
                </dl>
                <p className="muted">像素寬度用於試穿時的衣服比例，不是實際身材尺寸。</p>
              </div>
              <label className="field"><span>名稱</span><input value={name} maxLength={30} placeholder="例如：正面全身照" onChange={(e) => { setName(e.target.value); setDirty((d) => ({ ...d, analysis: true })); }} /></label>
              <div className="sticky-actions">
                <button className="btn btn-primary" disabled={!!busy || (!!id && !unsaved)} onClick={() => void save()}>{busy === '儲存中' ? '儲存中' : id ? (unsaved ? '儲存變更' : '已儲存') : '儲存全身照'}</button>
              </div>
              {id && !unsaved && <a className="btn btn-primary" href={`#/tryon/studio/${id}`}><Icon name="sparkle" size={18} /> 用這張照片試穿</a>}
              {id && <button className="link-btn danger" onClick={() => void del()}>刪除這張全身照</button>}
            </>
          )}
        </>
      )}
    </div>
  );
}

async function blobToCanvas(b: Blob) {
  const bmp = await createImageBitmap(b);
  const c = makeCanvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}
