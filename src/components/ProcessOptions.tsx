import { COST_NT } from '../lib/cloud-garment';
import type { CutoutMethod, JudgeMethod } from '../lib/types';

export const CUTOUT_OPTIONS: { id: CutoutMethod; title: string; cost: string; desc: string; paid: boolean }[] = [
  { id: 'local', title: '免費（手機去背）', cost: 'NT$0', desc: '在手機上處理，照片不會上傳。', paid: false },
  { id: 'gemini-mask', title: '付費：AI 標出範圍', cost: `每件約 NT$${COST_NT.mask}`, desc: 'Gemini 標出衣服範圍，用你的原圖去背，花紋不會變；邊緣稍粗。', paid: true },
  { id: 'gemini-redraw', title: '付費：白底重畫', cost: `每件約 NT$${COST_NT.redraw}`, desc: 'Gemini 把衣服重新畫在白底再去背，最乾淨；偶爾會改到花紋細節。', paid: true },
];
export const JUDGE_OPTIONS: { id: JudgeMethod; title: string; cost: string; desc: string; paid: boolean }[] = [
  { id: 'local', title: '免費（手機判斷）', cost: 'NT$0', desc: '判斷種類和顏色；季節、風格留空。', paid: false },
  { id: 'gemini', title: '付費：Gemini 判斷', cost: `每件約 NT$${COST_NT.judge}`, desc: '種類、顏色、季節、風格，並取好名稱。', paid: true },
];

/** 去背方式與判斷方式（設定頁的預設值、每批都能另外改） */
export function ProcessOptions({ cutout, judge, hasKey, onCutout, onJudge, name }: {
  cutout?: CutoutMethod; judge?: JudgeMethod; hasKey: boolean; name: string;
  onCutout?: (m: CutoutMethod) => void; onJudge?: (m: JudgeMethod) => void;
}) {
  return (
    <>
      {cutout && onCutout && (
        <fieldset className="card options process-opts">
          <legend>去背方式</legend>
          {CUTOUT_OPTIONS.filter((o) => hasKey || !o.paid).map((o) => (
            <label key={o.id} className="option">
              <input type="radio" name={`${name}-cutout`} checked={cutout === o.id} onChange={() => onCutout(o.id)} />
              <span><b>{o.title}<em className="cost">{o.cost}</em></b><small>{o.desc}</small></span>
            </label>
          ))}
        </fieldset>
      )}
      {judge && onJudge && (
        <fieldset className="card options process-opts">
          <legend>判斷種類、顏色、季節</legend>
          {JUDGE_OPTIONS.filter((o) => hasKey || !o.paid).map((o) => (
            <label key={o.id} className="option">
              <input type="radio" name={`${name}-judge`} checked={judge === o.id} onChange={() => onJudge(o.id)} />
              <span><b>{o.title}<em className="cost">{o.cost}</em></b><small>{o.desc}</small></span>
            </label>
          ))}
        </fieldset>
      )}
      {!hasKey && <p className="muted small-note">在「設定 → 雲端 AI」貼上 Gemini 金鑰後，可以選付費的去背與判斷。</p>}
    </>
  );
}

/** 依設定與是否有金鑰決定預設值 */
export function defaultMethods(s: { cutoutMethod?: CutoutMethod; judgeMethod?: JudgeMethod }, hasKey: boolean): { cutout: CutoutMethod; judge: JudgeMethod } {
  return { cutout: hasKey ? s.cutoutMethod ?? 'local' : 'local', judge: hasKey ? s.judgeMethod ?? 'gemini' : 'local' };
}
