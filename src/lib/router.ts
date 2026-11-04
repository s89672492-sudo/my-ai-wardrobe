/** 極簡 hash 路由：GitHub Pages 重新整理任何頁面都不會 404。 */
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';

export type Route =
  | { name: 'home' } | { name: 'wardrobe' } | { name: 'garment-new' }
  | { name: 'garment'; id: string } | { name: 'garment-edit'; id: string }
  | { name: 'tryon' } | { name: 'person-new' } | { name: 'person'; id: string } | { name: 'studio'; personId: string; garmentId?: string; outfitId?: string; garmentIds?: string[] } | { name: 'outfits' } | { name: 'settings' } | { name: 'diagnostics' } | { name: 'data' } | { name: 'acceptance' };

export type Path = '/' | '/wardrobe' | '/wardrobe/new' | `/wardrobe/item/${string}` | '/tryon' | '/tryon/person/new' | `/tryon/person/${string}` | `/tryon/studio/${string}` | '/outfits' | '/settings' | '/settings/diagnostics' | '/settings/data' | '/settings/acceptance';

function parse(hash = location.hash): Route {
  const h = decodeURIComponent(hash.replace(/^#/, '')).split('?')[0] || '/';
  const m = h.match(/^\/wardrobe\/item\/([\w-]+)(\/edit)?$/);
  if (m) return m[2] ? { name: 'garment-edit', id: m[1]! } : { name: 'garment', id: m[1]! };
  if (h === '/tryon/person/new') return { name: 'person-new' };
  const pm = h.match(/^\/tryon\/person\/([\w-]+)$/);
  if (pm) return { name: 'person', id: pm[1]! };
  const gm = h.match(/^\/tryon\/studio\/([\w-]+)\/g\/([\w,-]+)$/);
  if (gm) return { name: 'studio', personId: gm[1]!, garmentIds: gm[2]!.split(',') };
  const om = h.match(/^\/tryon\/studio\/([\w-]+)\/o\/([\w-]+)$/);
  if (om) return { name: 'studio', personId: om[1]!, outfitId: om[2] };
  const sm = h.match(/^\/tryon\/studio\/([\w-]+)(?:\/([\w-]+))?$/);
  if (sm) return { name: 'studio', personId: sm[1]!, garmentId: sm[2] };
  switch (h) {
    case '/wardrobe': return { name: 'wardrobe' };
    case '/wardrobe/new': return { name: 'garment-new' };
    case '/tryon': return { name: 'tryon' };
    case '/outfits': return { name: 'outfits' };
    case '/settings': return { name: 'settings' };
    case '/settings/diagnostics': return { name: 'diagnostics' };
    case '/settings/data': return { name: 'data' };
    case '/settings/acceptance': return { name: 'acceptance' };
    default: return { name: 'home' };
  }
}

type VT = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> };
let activeTransition: VT | null = null;
/** 已開始轉場、但畫面還沒換過去的換頁 */
let pending: { h: string; done: boolean } | null = null;

export function useRoute(): Route {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    // 換頁：支援 View Transitions 的瀏覽器（iOS 18+ Safari、Chrome）用淡出淡入；
    // 捲回頂端在轉場「之內」完成，畫面不會先跳一下。系統設定「減少動態效果」時直接切換。
    const commit = (h: string) => { setHash(h); window.scrollTo(0, 0); };
    const on = () => {
      const h = location.hash;
      // 連續換頁（例如 A → B → A 間隔很短）：先把還沒換過去的頁面確實換過去，
      // 否則 React 會以為一直停在 A，沿用舊頁面的狀態（例如卡在「儲存中」）
      if (pending && !pending.done) { const p = pending; p.done = true; flushSync(() => commit(p.h)); }
      const doc = document as Document & { startViewTransition?: (cb: () => void) => VT };
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!doc.startViewTransition || reduce || activeTransition || document.visibilityState !== 'visible') { commit(h); return; }
      const p = { h, done: false };
      pending = p;
      // 轉場的回呼可能晚到；若期間又換頁（p.done），就不再套用這個過期的網址
      const t = doc.startViewTransition(() => { if (!p.done) { p.done = true; flushSync(() => commit(h)); } });
      activeTransition = t;
      const ignore = () => { /* 轉場被略過只影響動畫，不是錯誤 */ };
      t.ready.catch(ignore);
      t.updateCallbackDone.catch(ignore);
      void t.finished.catch(ignore).finally(() => { if (activeTransition === t) activeTransition = null; });
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return useMemo(() => parse(hash), [hash]);
}

export function navigate(to: Path, replace = false) {
  if (replace) location.replace(`#${to}`);
  else location.hash = to;
}
export const href = (to: Path) => `#${to}`;
