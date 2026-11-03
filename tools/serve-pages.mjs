/**
 * 模擬 GitHub Pages 的靜態伺服器（測試用）：dist/ 掛在 BASE_PATH 下，
 * 找不到的路徑回傳 404 + 404.html，與 GitHub Pages 行為相同（vite preview 會回 index.html，無法測出 404 問題）。
 * 用法：node tools/serve-pages.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const base = process.env.BASE_PATH ?? '/my-ai-wardrobe/';
const port = +(process.argv[2] ?? 4174);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let rel = url.pathname.startsWith(base) ? decodeURIComponent(url.pathname.slice(base.length)) : null;
  let file = rel === null ? null : path.join(dist, rel);
  if (file && !file.startsWith(dist)) file = null;
  try {
    if (file && (await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    res.end(await readFile(path.join(dist, '404.html')).catch(() => 'Not Found'));
  }
}).listen(port, () => console.log(`GitHub Pages 模擬：http://localhost:${port}${base}`));
