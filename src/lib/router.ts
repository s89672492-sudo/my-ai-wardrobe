/** 極簡 hash 路由：GitHub Pages 重新整理任何頁面都不會 404。 */
import { useEffect, useState } from 'react';

export type Route = '/' | '/wardrobe' | '/tryon' | '/outfits' | '/settings' | '/settings/diagnostics';
const ROUTES: Route[] = ['/', '/wardrobe', '/tryon', '/outfits', '/settings', '/settings/diagnostics'];

function parse(): Route {
  const h = location.hash.replace(/^#/, '') || '/';
  return (ROUTES as string[]).includes(h) ? (h as Route) : '/';
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

export function navigate(to: Route) { location.hash = to; }
export const href = (to: Route) => `#${to}`;
