/** 極簡 hash 路由：GitHub Pages 重新整理任何頁面都不會 404。 */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' } | { name: 'wardrobe' } | { name: 'garment-new' }
  | { name: 'garment'; id: string } | { name: 'garment-edit'; id: string }
  | { name: 'tryon' } | { name: 'person-new' } | { name: 'person'; id: string } | { name: 'outfits' } | { name: 'settings' } | { name: 'diagnostics' };

export type Path = '/' | '/wardrobe' | '/wardrobe/new' | `/wardrobe/item/${string}` | '/tryon' | '/tryon/person/new' | `/tryon/person/${string}` | '/outfits' | '/settings' | '/settings/diagnostics';

function parse(): Route {
  const h = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  const m = h.match(/^\/wardrobe\/item\/([\w-]+)(\/edit)?$/);
  if (m) return m[2] ? { name: 'garment-edit', id: m[1]! } : { name: 'garment', id: m[1]! };
  if (h === '/tryon/person/new') return { name: 'person-new' };
  const pm = h.match(/^\/tryon\/person\/([\w-]+)$/);
  if (pm) return { name: 'person', id: pm[1]! };
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
