/** 極簡 hash 路由：GitHub Pages 重新整理任何頁面都不會 404。 */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' } | { name: 'wardrobe' } | { name: 'garment-new' }
  | { name: 'garment'; id: string } | { name: 'garment-edit'; id: string }
  | { name: 'tryon' } | { name: 'person-new' } | { name: 'person'; id: string } | { name: 'studio'; personId: string; garmentId?: string; outfitId?: string; garmentIds?: string[] } | { name: 'outfits' } | { name: 'settings' } | { name: 'diagnostics' };

export type Path = '/' | '/wardrobe' | '/wardrobe/new' | `/wardrobe/item/${string}` | '/tryon' | '/tryon/person/new' | `/tryon/person/${string}` | `/tryon/studio/${string}` | '/outfits' | '/settings' | '/settings/diagnostics';

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
    default: return { name: 'home' };
  }
}

export function useRoute(): Route {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const on = () => { setR(parse()); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function navigate(to: Path, replace = false) {
  if (replace) location.replace(`#${to}`);
  else location.hash = to;
}
export const href = (to: Path) => `#${to}`;
