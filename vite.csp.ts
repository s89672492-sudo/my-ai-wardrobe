import type { Plugin } from 'vite';

/**
 * 正式版加入 Content-Security-Policy：
 * connect-src 'self' 讓頁面在技術上無法把資料送到其他網域（隱私保證）。
 * 'unsafe-eval' / 'wasm-unsafe-eval'：部分瀏覽器（Safari）會把頁面政策套用到 AI Worker，
 * 而 LiteRT.js 需要載入 wasm glue 與編譯 WebAssembly。
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export function cspPlugin(): Plugin {
  return {
    name: 'wardrobe-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}
