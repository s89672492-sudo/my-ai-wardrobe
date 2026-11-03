/**
 * 端對端測試（Playwright，模擬 iPhone / Pixel）。需先 `npm run build` 並啟動 `vite preview --port 4173`。
 * 用法：node tests/e2e/run.mjs [裝置名稱]
 */
import { chromium, devices } from 'playwright';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS = path.join(here, '.photos');
const OUT = path.join(here, '.out');
const BASE = process.env.E2E_URL ?? 'http://localhost:4173/my-ai-wardrobe/';
const DEVICE = process.argv[2] ?? 'iPhone 13';
await mkdir(OUT, { recursive: true });

let failed = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'} [${DEVICE}] ${msg}`); if (!c) failed++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices[DEVICE] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const tag = DEVICE.replace(/\W+/g, '');
const idle = () => page.waitForFunction(() => !document.querySelector('.stage-busy'), null, { timeout: 180000 });

try {
  await page.goto(BASE + '#/tryon');
  await page.evaluate(() => navigator.serviceWorker.ready);

  // 1. 新增全身照 → AI 辨識
  for (const [file, expect] of [['photo-02.jpg', {}], ['photo-01.jpg', { armFront: true }], ['photo-03.jpg', {}]]) {
    await page.goto(BASE + '#/tryon/person/new');
    await page.locator('input[type=file]:not([capture])').setInputFiles(path.join(PHOTOS, file));
    await page.waitForSelector('.checks', { timeout: 180000 });
    await idle();
    const checks = await page.locator('.checks li').allInnerTexts();
    const specs = await page.locator('.specs').innerText();
    console.log(`--- ${file}\n  ${checks.join('\n  ')}\n  ${specs.replace(/\n/g, ' | ')}`);
    ok(!checks.some((c) => c.startsWith('✕')), `${file}: core keypoints detected`);
    ok(/人體輪廓實際量測/.test(specs), `${file}: widths measured from silhouette`);
    if (expect.armFront) ok(/在身體前方/.test(specs), `${file}: arm in front of torso detected`);
    await page.screenshot({ path: path.join(OUT, `${tag}-${file}.png`), fullPage: true });
    await page.click('button:has-text("儲存全身照")');
    await page.waitForURL(/#\/tryon\/person\/[\w-]+$/);
    await page.waitForSelector('.checks');
  }

  // 2. 校正關鍵點（拖曳左肩）→ 儲存 → 重新整理仍保留
  await page.click('button:has-text("校正關鍵點")');
  const before = await page.locator('.specs').innerText();
  const box = await page.locator('.cutout-stage canvas').boundingBox();
  const kp = await page.evaluate(async () => {
    const id = location.hash.split('/').pop();
    const db = await new Promise((r) => { const q = indexedDB.open('my-ai-wardrobe'); q.onsuccess = () => r(q.result); });
    const p = await new Promise((r) => { const t = db.transaction('persons').objectStore('persons').get(id); t.onsuccess = () => r(t.result); });
    return { ls: p.analysis.keypoints[5], w: p.analysis.imageW, h: p.analysis.imageH };
  });
  const sx = box.x + (kp.ls.x / kp.w) * box.width, sy = box.y + (kp.ls.y / kp.h) * box.height;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 25, sy - 10, { steps: 6 }); await page.mouse.up();
  await page.click('button:has-text("完成校正")');
  const after = await page.locator('.specs').innerText();
  ok(before !== after && /手動校正/.test(after), 'dragging a keypoint updates measurements');
  await page.click('button:has-text("儲存變更")');
  await page.waitForSelector('button:has-text("已儲存")');
  await page.reload();
  await page.waitForSelector('.specs');
  ok(/手動校正/.test(await page.locator('.specs').innerText()), 'correction persisted after reload');

  // 3. 列表
  await page.goto(BASE + '#/tryon');
  await page.waitForSelector('.garment-card');
  ok((await page.locator('.garment-card').count()) === 3, '3 full-body photos listed');
  console.log('  cards:', (await page.locator('.garment-meta').allInnerTexts()).join(' / '));

  // 4. 離線重新辨識（模型已快取）
  await ctx.setOffline(true);
  await page.click('.garment-card >> nth=0');
  await page.waitForSelector('.specs');
  await page.click('button:has-text("重新辨識")');
  await page.waitForTimeout(300);
  await idle();
  ok(!(await page.locator('.alert-err').count()), 'offline re-analysis works');
  await ctx.setOffline(false);

  // 5. 技術檢測頁兩個模型都能載入
  await page.goto(BASE + '#/settings/diagnostics');
  await page.waitForSelector('dl');
  await page.selectOption('select >> nth=1', 'wasm');
  await page.click('button:has-text("載入模型")');
  await page.waitForFunction(() => !document.querySelector('.status')?.textContent?.includes('⏳'), null, { timeout: 120000 });
  const log = await page.locator('.log').innerText();
  ok(/MoveNet 載入成功/.test(log) && /Selfie Segmenter 載入成功/.test(log), 'diagnostics: both models load');
} catch (e) {
  ok(false, `exception: ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: path.join(OUT, `${tag}-error.png`), fullPage: true }).catch(() => {});
}
ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
