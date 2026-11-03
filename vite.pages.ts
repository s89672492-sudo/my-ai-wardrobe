import type { Plugin } from 'vite';

/**
 * GitHub Pages 專用輸出：
 * - 404.html：有人直接開啟 /<repo>/wardrobe 這類沒有 # 的網址時，GitHub Pages 會回傳此頁，
 *   轉址到 /<repo>/#/wardrobe（App 使用 hash 路由，任何頁面重新整理都不會 404）。
 * - version.json：部署版本資訊，供部署後驗收確認線上版本，不會被 Service Worker 快取。
 */
export function pagesPlugin(base: string, version: string, build: string): Plugin {
  return {
    name: 'wardrobe-pages',
    apply: 'build',
    generateBundle() {
      const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="UTF-8"><title>AI 衣櫥</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>
(function () {
  var base = ${JSON.stringify(base)};
  var p = location.pathname;
  var rest = p.indexOf(base) === 0 ? p.slice(base.length).replace(/[/]+$/, '') : '';
  location.replace(base + (rest ? '#/' + rest : location.hash));
})();
</script></head>
<body><p>正在開啟 AI 衣櫥… <a href="${base}">點這裡</a></p></body></html>
`;
      this.emitFile({ type: 'asset', fileName: '404.html', source: html });
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, build, base }) + '\n' });
    },
  };
}
