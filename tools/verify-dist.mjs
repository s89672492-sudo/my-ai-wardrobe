/**
 * 部署前檢查 dist/（GitHub Pages 要上傳的內容）。任何一項失敗就中止部署。
 * 用法：npm run verify-dist（需先 npm run build；BASE_PATH 與建置時相同）
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from './models.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const base = process.env.BASE_PATH ?? '/my-ai-wardrobe/';
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

let failed = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failed++; };
const check = (cond, m) => (cond ? ok(m) : bad(m));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push({ rel: path.relative(dist, p).split(path.sep).join('/'), size: (await stat(p)).size });
  }
  return out;
}

console.log(`檢查 dist/（base = ${base}）`);
const files = await walk(dist);
const byRel = new Map(files.map((f) => [f.rel, f]));

console.log('\n[1] 網址路徑（base path）');
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
check(refs.length > 0 && refs.every((u) => u.startsWith(base)), `index.html 的 ${refs.length} 個資源網址都以 ${base} 開頭`);
for (const u of refs) if (!byRel.has(u.slice(base.length))) bad(`index.html 引用的檔案不存在：${u}`);
check(html.includes('http-equiv="Content-Security-Policy"') && html.includes("connect-src 'self'"), "CSP：connect-src 'self'（頁面無法把資料送到其他網域）");

console.log('\n[2] PWA manifest 與圖示');
const mf = JSON.parse(await readFile(path.join(dist, 'manifest.webmanifest'), 'utf8'));
check(mf.start_url === base && mf.scope === base && mf.id === base, `start_url / scope / id = ${base}`);
check(mf.display === 'standalone' && mf.lang?.startsWith('zh'), 'display=standalone、繁體中文');
for (const ic of mf.icons) {
  const f = path.join(dist, ic.src);
  if (!(await exists(f))) { bad(`圖示不存在：${ic.src}`); continue; }
  const b = await readFile(f);
  const [w, h] = [b.readUInt32BE(16), b.readUInt32BE(20)];
  check(`${w}x${h}` === ic.sizes, `${ic.src} ${w}×${h}${ic.purpose ? `（${ic.purpose}）` : ''}`);
}
check(await exists(path.join(dist, 'icons/apple-touch-icon.png')), 'iPhone 主畫面圖示 apple-touch-icon.png');

console.log('\n[3] Service Worker');
const sw = await readFile(path.join(dist, 'sw.js'), 'utf8');
const precache = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
check(precache.length > 0, `預先快取 ${precache.length} 個檔案`);
check(!precache.some((u) => /^(models|litert-wasm)\//.test(u)), '模型與 wasm 不在預先快取（首次使用 AI 時才下載，避免安裝 App 就耗用大量流量）');
const missing = precache.filter((u) => !byRel.has(u));
check(!missing.length, `預先快取的檔案都存在${missing.length ? `（缺 ${missing.join(', ')}）` : ''}`);
const preSize = precache.reduce((s, u) => s + (byRel.get(u)?.size ?? 0), 0);
check(preSize < 3 * 1024 * 1024, `預先快取總大小 ${kb(preSize)}（上限 3 MB）`);
check(sw.includes(`${base}index.html`), `離線時任何頁面都回應 ${base}index.html`);

console.log('\n[4] 重新整理與深層網址');
const nf = await readFile(path.join(dist, '404.html'), 'utf8').catch(() => '');
check(nf.includes(JSON.stringify(base)) && nf.includes("'#/'"), '404.html 會把 /…/wardrobe 這類網址轉到 #/wardrobe');
{
  // 實際執行 404.html 的轉址程式，確認語法正確、轉址結果正確
  const js = nf.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const run = (pathname, hash = '') => { let to = null; try { new Function('location', js)({ pathname, hash, replace: (u) => { to = u; } }); } catch (e) { return `錯誤：${e.message}`; } return to; };
  for (const [from, want] of [[`${base}wardrobe`, `${base}#/wardrobe`], [`${base}settings/data/`, `${base}#/settings/data`], [`${base}missing.png`, `${base}#/missing.png`]]) {
    const got = run(from);
    check(got === want, `404.html：${from} → ${got}`);
  }
}
const ver = JSON.parse(await readFile(path.join(dist, 'version.json'), 'utf8'));
check(ver.version === pkg.version && ver.base === base, `version.json：${ver.version}（${ver.build}）`);

console.log('\n[5] AI 模型（版本固定來源 + SHA-256）');
for (const m of MODELS) {
  const f = path.join(dist, 'models', m.file);
  if (!(await exists(f))) { bad(`缺少模型 ${m.file}（請先 npm run fetch-models）`); continue; }
  const b = await readFile(f);
  check(sha(b) === m.sha256 && b.subarray(4, 8).toString() === 'TFL3', `${m.file} ${kb(b.length)} SHA-256 相符`);
}
const extraModels = files.filter((f) => f.rel.startsWith('models/') && !MODELS.some((m) => `models/${m.file}` === f.rel));
check(!extraModels.length, `models/ 沒有清單以外的檔案${extraModels.length ? `：${extraModels.map((f) => f.rel).join(', ')}` : ''}`);
const wasmSrc = path.join(root, 'node_modules/@litertjs/core/wasm');
const wasmFiles = await readdir(wasmSrc);
let wasmOk = wasmFiles.length > 0;
for (const n of wasmFiles) {
  const d = path.join(dist, 'litert-wasm', n);
  if (!(await exists(d)) || sha(await readFile(d)) !== sha(await readFile(path.join(wasmSrc, n)))) { wasmOk = false; bad(`litert-wasm/${n} 與 @litertjs/core 套件不一致`); }
}
check(wasmOk, `LiteRT.js ${pkg.dependencies['@litertjs/core']} 執行環境 ${wasmFiles.length} 個檔案與 npm 套件（package-lock 鎖定版本）一致`);

console.log('\n[6] 隱私');
const imgs = files.filter((f) => /\.(jpe?g|png|webp|heic|heif|gif|avif|bmp|tiff?)$/i.test(f.rel) && !f.rel.startsWith('icons/'));
check(!imgs.length, `除了 App 圖示，沒有任何圖片檔${imgs.length ? `：${imgs.map((f) => f.rel).join(', ')}` : ''}`);
check(!files.some((f) => f.rel.endsWith('.map')), '沒有 source map');
const CLOUD_AI = ['api.openai.com', 'generativelanguage.googleapis.com', 'aiplatform.googleapis.com', 'api.replicate.com', 'api-inference.huggingface.co', 'router.huggingface.co', 'api.anthropic.com', 'api.stability.ai', 'api.fal.ai', 'firebaseio.com', 'supabase.co'];
const code = (await Promise.all(files.filter((f) => /\.(js|html|json|webmanifest)$/.test(f.rel)).map((f) => readFile(path.join(dist, f.rel), 'utf8')))).join('\n');
const hits = CLOUD_AI.filter((h) => code.includes(h));
check(!hits.length, `程式碼中沒有雲端 AI 或雲端資料庫網址${hits.length ? `：${hits.join(', ')}` : ''}`);

console.log('\n[7] 檔案大小');
const big = files.filter((f) => f.size > 1024 * 1024 && !/^(models|litert-wasm)\//.test(f.rel));
check(!big.length, `模型與 wasm 以外沒有超過 1 MB 的檔案${big.length ? `：${big.map((f) => `${f.rel} ${kb(f.size)}`).join(', ')}` : ''}`);
check(files.every((f) => f.size < 100 * 1024 * 1024), '所有檔案都小於 GitHub Pages 單檔 100 MB 限制');
const total = files.reduce((s, f) => s + f.size, 0);
ok(`總大小 ${(total / 1024 / 1024).toFixed(1)} MB，共 ${files.length} 個檔案（GitHub Pages 網站上限 1 GB）`);

if (failed) { console.error(`\n✗ ${failed} 項檢查失敗，停止部署`); process.exit(1); }
console.log('\n✓ 全部通過');
