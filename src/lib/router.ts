/** 極簡 hash 路由：GitHub Pages 重新整理任何頁面都不會 404。 */
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';

export type Route =
  | { name: 'home' } | { name: 'wardrobe' } | { name: 'garment-new' }
  | { name: 'garment'; id: string } | { name: 'garment-edit'; id: string }
  | { name: 'tryon' } | { name: 'person-new' } | { name: 'person'; id: string } | { name: 'studio'; personId: string; garmentId?: string; outfitId?: string; garmentIds?: string[] } | { name: 'outfits' } | { name: 'settings' } | { name: 'diagnostics' } | { name: 'data' } | { name: 'acceptance' };

export type Path = '/' | '/wardrobe' | '/wardrobe/new' | `/wardrobe/item/${string}` | '/tryon' | '/tryon/person/new' | `/tryon/person/${string}` | `/tryon/studio/${string}` | '/outfits' | '/settings' | '/settings/diagnostics' | '/settings/data' | '/settings/acceptance';

function parse(): Route {
  const h = decodeURIComponent(location.hash.replace(/^#/, '')).split('?')[0] || '/';
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

export function useRoute(): Route {
  // 以網址字串為狀態：重複設定同一個值不會多渲染，轉場被略過時也能補回正確頁面
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    // 換頁：支援 View Transitions 的瀏覽器（iOS 18+ Safari、Chrome）用淡出淡入；
    // 捲回頂端在轉場「之內」完成，畫面不會先跳一下。系統設定「減少動態效果」時直接切換。
    const on = () => {
      const apply = () => { setHash(location.hash); window.scrollTo(0, 0); };
      const doc = document as Document & { startViewTransition?: (cb: () => void) => VT };
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      // 上一個轉場還沒結束（快速連點）就直接切換，不疊加轉場
      if (!doc.startViewTransition || reduce || activeTransition || document.visibilityState !== 'visible') { apply(); return; }
      const t = doc.startViewTransition(() => flushSync(apply));
      activeTransition = t;
      const ignore = () => { /* 轉場被略過只影響動畫，不是錯誤 */ };
      t.ready.catch(ignore);
      t.updateCallbackDone.catch(ignore);
      void t.finished.catch(ignore).finally(() => {
        if (activeTransition === t) activeTransition = null;
        setHash(location.hash); // 保險：確保畫面停在目前網址的頁面
      });
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return useMemo(() => parse(), [hash]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function navigate(to: Path, replace = false) {
  if (replace) location.replace(`#${to}`);
  else location.hash = to;
}
export const href = (to: Path) => `#${to}`;
