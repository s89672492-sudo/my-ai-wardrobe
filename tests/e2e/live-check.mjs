/**
 * 部署後驗收：對「線上的 GitHub Pages 網站」實際檢查（Deploy workflow 最後一步）。
 * 用法：LIVE_URL=https://<user>.github.io/<repo>/ EXPECT_BUILD=<commit 前 7 碼> node tests/e2e/live-check.mjs
 */
import { chromium, devices } from 'playwright';
import { createHash } from 'node:crypto';
import { MODELS } from '../../tools/models.mjs';

const BASE = (process.env.LIVE_URL ?? '').replace(/\/?$/, '/');
const EXPECT = (process.env.EXPECT_BUILD ?? '').slice(0, 7);
if (!BASE.startsWith('http')) { console.error('請設定 LIVE_URL'); process.exit(2); }
const basePath = new URL(BASE).pathname;

let failed = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'} ${msg}`); if (!c) failed++; };
const get = (p, init) => fetch(new URL(p, BASE), { cache: 'no-store', ...init });

// 1. 等 GitHub Pages CDN 換成這次部署的版本
let ver = null;
for (let i = 0; i < 40; i++) {
  ver = await get(`version.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (ver && (!EXPECT || ver.build === EXPECT)) break;
  await new Promise((r) => setTimeout(r, 10_000));
}
ok(!!ver && (!EXPECT || ver.build === EXPECT), `線上版本 ${ver?.version}（${ver?.build}）${EXPECT ? ` = 這次部署 ${EXPECT}` : ''}`);
ok(ver?.base === basePath, `base path ${ver?.base} 與網址 ${basePath} 一致`);

// 2. HTTP：主要檔案、模型、執行環境
const idx = await get('');
ok(idx.ok && /text\/html/.test(idx.headers.get('content-type') ?? ''), `首頁 ${idx.status} ${idx.headers.get('content-type')}`);
if (new URL(BASE).hostname === 'localhost') console.log('SKIP 本機測試伺服器不檢查 HTTPS');
else ok(idx.url.startsWith('https://'), '使用 HTTPS（Service Worker、相機與安裝 App 都需要）');
const html = await idx.text();
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const refStatus = await Promise.all(refs.map((u) => get(u).then((r) => r.status)));
ok(refStatus.every((s) => s === 200), `首頁引用的 ${refs.length} 個檔案都能載入`);
const mf = await get('manifest.webmanifest');
const mfj = await mf.json().catch(() => null);
ok(mf.ok && mfj?.start_url === basePath && mfj?.scope === basePath, `manifest：start_url / scope = ${basePath}`);
const icons = await Promise.all((mfj?.icons ?? []).map((i) => get(i.src).then((r) => r.ok && /image\/png/.test(r.headers.get('content-type') ?? ''))));
ok(icons.length >= 3 && icons.every(Boolean), `manifest 的 ${icons.length} 個圖示都能載入`);
ok((await get('icons/apple-touch-icon.png')).ok, 'iPhone 主畫面圖示');
const sw = await get('sw.js');
ok(sw.ok && /javascript/.test(sw.headers.get('content-type') ?? ''), `sw.js ${sw.status} ${sw.headers.get('content-type')}`);
for (const m of MODELS) {
  const r = await get(`models/${m.file}`);
  const b = Buffer.from(await r.arrayBuffer());
  ok(r.ok && createHash('sha256').update(b).digest('hex') === m.sha256, `模型 ${m.file}：${(b.length / 1024).toFixed(0)} KB，SHA-256 與固定版本相符`);
}
const wasm = await get('litert-wasm/litert_wasm_compat_internal.wasm');
ok(wasm.ok && (wasm.headers.get('content-type') ?? '').includes('wasm'), `LiteRT 執行環境（iPhone 用的 compat 版）${wasm.status} ${wasm.headers.get('content-type')}`);
const nf = await get('wardrobe');
const nfText = await nf.text();
ok(nf.status === 404 && nfText.includes("'#/'"), `沒有 # 的深層網址由 404.html 接手（HTTP ${nf.status}）`);

// 3. 瀏覽器實際操作（模擬 iPhone 13）
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (/Content Security Policy|Refused to (connect|load|execute)/i.test(m.text())) errors.push('CSP: ' + m.text().slice(0, 200)); });
const external = [];
page.on('request', (r) => { const u = new URL(r.url()); if (!['blob:', 'data:'].includes(u.protocol) && u.origin !== new URL(BASE).origin) external.push(r.url()); });
const textOf = () => page.locator('main').innerText();

try {
  await page.goto(BASE);
  await page.waitForSelector('h1', { timeout: 20000 });
  ok((await page.title()) === 'AI 衣櫥', '首頁開啟');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Service Worker 已安裝並接管頁面');

  // 重新整理各頁面
  for (const [route, text] of [['#/wardrobe', '我的衣櫥'], ['#/tryon', 'AI 試穿'], ['#/outfits', '穿搭收藏'], ['#/settings', 'AI 模型'], ['#/settings/data', '隱私保護']]) {
    await page.goto(BASE + route);
    await page.reload();
    await page.waitForFunction((t) => document.querySelector('main')?.innerText.includes(t), text, { timeout: 15000 }).catch(() => {});
    ok((await textOf()).includes(text), `重新整理 ${route} 仍顯示「${text}」`);
  }
  await page.goto(BASE + '#/settings');
  ok((await textOf()).includes(`（${ver?.build}）`), `設定頁顯示部署代號 ${ver?.build}`);

  // 沒有 # 的網址（分享或手動輸入）：在線上由 404.html 轉址；Service Worker 安裝後由 App 轉換
  const fresh = await browser.newContext({ ...devices['iPhone 13'] });
  const p2 = await fresh.newPage();
  await p2.goto(BASE + 'outfits');
  await p2.waitForURL(/#\/outfits$/, { timeout: 15000 }).catch(() => {});
  ok(p2.url().endsWith('#/outfits') && (await p2.locator('main').innerText()).includes('穿搭收藏'), `首次開啟 ${basePath}outfits → #/outfits`);
  await fresh.close();
  await page.goto(BASE + 'settings/data');
  await page.waitForURL(/#\/settings\/data$/, { timeout: 15000 }).catch(() => {});
  ok(page.url().endsWith('#/settings/data'), `已安裝後開啟 ${basePath}settings/data → #/settings/data`);

  // 下載 AI 模型（由 AI Worker 存入快取），再離線測試
  await page.goto(BASE + '#/settings');
  await page.click('button:has-text("下載 AI 模型")');
  await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('已下載'), null, { timeout: 180000 }).catch(() => {});
  ok((await textOf()).includes('已下載'), '設定頁「下載 AI 模型」完成，顯示已下載');

  await ctx.setOffline(true);
  for (const [route, text] of [['', '今天想穿什麼'], ['#/wardrobe', '我的衣櫥'], ['#/settings', '已下載']]) {
    await page.goto(BASE + route).catch(() => {});
    await page.waitForFunction((t) => document.querySelector('main')?.innerText.includes(t), text, { timeout: 15000 }).catch(() => {});
    ok((await textOf()).includes(text), `離線開啟 ${route || '首頁'} 正常（${text}）`);
  }
  ok(await page.locator('.offline-bar').isVisible(), '離線時顯示「目前離線」提示');
  await page.goto(BASE + 'wardrobe').catch(() => {});
  await page.waitForURL(/#\/wardrobe$/, { timeout: 15000 }).catch(() => {});
  ok(page.url().endsWith('#/wardrobe') && (await textOf()).includes('我的衣櫥'), '離線開啟沒有 # 的網址也能進入 App');
  await ctx.setOffline(false);
} catch (e) {
  ok(false, `例外：${e.message}`);
} finally {
  ok(!errors.length, `沒有頁面錯誤或 CSP 違規${errors.length ? '：\n  ' + errors.join('\n  ') : ''}`);
  ok(!external.length, `沒有連到其他網域${external.length ? '：\n  ' + [...new Set(external)].join('\n  ') : ''}`);
  await browser.close();
}
console.log(failed ? `\n${failed} 項失敗` : '\n部署驗收全部通過');
process.exit(failed ? 1 : 0);
