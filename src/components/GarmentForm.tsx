import { COLORS } from '../lib/image';
import { CATEGORIES, SEASONS, SEASON_LABEL, type CategoryId, type Season } from '../lib/types';
import type { GarmentMeta } from '../lib/garments';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'F', '26', '28', '30', '32', '34', '36', '38', '40'];

export function GarmentForm({ value, onChange }: { value: GarmentMeta; onChange: (v: GarmentMeta) => void }) {
  const set = <K extends keyof GarmentMeta>(k: K, v: GarmentMeta[K]) => onChange({ ...value, [k]: v });
  const toggleSeason = (s: Season) => set('seasons', value.seasons.includes(s) ? value.seasons.filter((x) => x !== s) : [...value.seasons, s]);
  const catLabel = CATEGORIES.find((c) => c.id === value.category)?.label ?? '';

  return (
    <div className="form">
      <label className="field">
        <span>名稱</span>
        <input value={value.name} maxLength={40} placeholder={`例如：${value.color || '白色'}${catLabel || 'T-shirt'}`} onChange={(e) => set('name', e.target.value)} />
      </label>

      <div className="field">
        <span>分類 <em>必填</em></span>
        <div className="chip-grid">
          {CATEGORIES.map((c) => (
            <button type="button" key={c.id} className={value.category === c.id ? 'chip on' : 'chip'} onClick={() => set('category', c.id as CategoryId)}>{c.label}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>顏色{value.color && <b className="field-value">{value.color}</b>}</span>
        <div className="swatches">
          {COLORS.map((c) => (
            <button type="button" key={c.label} aria-label={c.label} title={c.label} className={value.color === c.label ? 'swatch on' : 'swatch'} style={{ background: c.hex }} onClick={() => set('color', value.color === c.label ? '' : c.label)} />
          ))}
        </div>
      </div>

      <div className="field-row">
        <label className="field"><span>品牌</span><input value={value.brand} maxLength={40} placeholder="選填" onChange={(e) => set('brand', e.target.value)} /></label>
        <label className="field"><span>尺寸</span><input value={value.size} maxLength={12} placeholder="選填" list="sizes" onChange={(e) => set('size', e.target.value)} /></label>
        <datalist id="sizes">{SIZES.map((s) => <option key={s} value={s} />)}</datalist>
      </div>

      <div className="field">
        <span>季節</span>
        <div className="chip-grid four">
          {SEASONS.map((s) => (
            <button type="button" key={s} className={value.seasons.includes(s) ? 'chip on' : 'chip'} onClick={() => toggleSeason(s)}>{SEASON_LABEL[s]}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>風格 <em>選填，用於穿搭推薦</em></span>
        <div className="chip-grid three">
          {([['casual', '休閒'], ['formal', '正式'], ['sport', '運動']] as const).map(([k, l]) => {
            const on = (value.styles ?? []).includes(k);
            return <button type="button" key={k} className={on ? 'chip on' : 'chip'} onClick={() => set('styles', on ? (value.styles ?? []).filter((x) => x !== k) : [...(value.styles ?? []), k])}>{l}</button>;
          })}
        </div>
      </div>

      <label className="field"><span>備註</span><textarea rows={3} maxLength={300} value={value.notes} placeholder="例如：購買地點、搭配想法" onChange={(e) => set('notes', e.target.value)} /></label>

      <label className="option toggle">
        <span><b>加入收藏</b></span>
        <input type="checkbox" role="switch" checked={!!value.favorite} onChange={(e) => set('favorite', e.target.checked ? 1 : 0)} />
      </label>
    </div>
  );
}
