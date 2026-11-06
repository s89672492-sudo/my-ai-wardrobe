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
// 隱私：任何違反 CSP 的連線或腳本都算失敗
page.on('console', (m) => { if (/Content Security Policy|Refused to (connect|load|execute)/i.test(m.text())) errors.push('CSP: ' + m.text().slice(0, 200)); });
page.on('dialog', (d) => d.accept());
const tag = DEVICE.replace(/\W+/g, '');
const idle = () => page.waitForFunction(() => !document.querySelector('.stage-busy'), null, { timeout: 180000 });

try {
  await page.goto(BASE + '#/tryon');
  await page.evaluate(() => navigator.serviceWorker.ready);

  // 1. 新增全身照 → AI 辨識
  for (const [file, expect] of [['photo-02.jpg', {}], ['photo-01.jpg', { akimbo: true }], ['photo-03.jpg', { akimbo: true }]]) {
    await page.goto(BASE + '#/tryon/person/new');
    await page.waitForSelector('.pick', { timeout: 15000 });
    await page.locator('input[type=file]:not([capture])').setInputFiles(path.join(PHOTOS, file));
    await page.waitForSelector('.checks', { timeout: 180000 });
    await idle();
    const checks = await page.locator('.checks li').allInnerTexts();
    const specs = await page.locator('.specs').innerText();
    console.log(`--- ${file}\n  ${checks.map((c) => c.replace(/\n/g, ' ')).join('\n  ')}\n  ${specs.replace(/\n/g, ' | ')}`);
    ok(!checks.some((c) => c.startsWith('✕')), `${file}: core keypoints detected`);
    ok(/人體輪廓實際量測/.test(specs), `${file}: widths measured from silhouette`);
    if (expect.akimbo) ok(/叉腰/.test(specs), `${file}: hand-on-hip (akimbo) detected`);
    await page.screenshot({ path: path.join(OUT, `${tag}-${file}.png`), fullPage: true });
    await page.click('button:has-text("儲存全身照")');
    await page.waitForURL(/#\/tryon\/person\/(?!new$)[\w-]+$/, { timeout: 30000 });
    await page.waitForSelector('.checks');
    // 輸出關鍵點，供離線檢查幾何量測
    const dump = await page.evaluate(async () => {
      const id = location.hash.split('/').pop();
      const db = await new Promise((r) => { const q = indexedDB.open('my-ai-wardrobe'); q.onsuccess = () => r(q.result); });
      const p = await new Promise((r) => { const t = db.transaction('persons').objectStore('persons').get(id); t.onsuccess = () => r(t.result); });
      const a = p.analysis;
      return { parse: !!p.parseImageId, w: a.imageW, h: a.imageH, maskRect: a.maskRect, kp: a.keypoints.map((k) => [Math.round(k.x), Math.round(k.y), +k.score.toFixed(2)]) };
    });
    console.log(`KP ${file} ${JSON.stringify(dump)}`);
    ok(dump.parse, `${file}: hair/skin/clothes parse map saved`);
  }

  // 2. 校正關鍵點（拖曳左肩）→ 儲存 → 重新整理仍保留
  await page.click('button:has-text("校正關鍵點")');
  await page.waitForTimeout(600); // 等待自動捲動到照片
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
  await page.waitForURL(/#\/tryon\/studio\//);
  ok(true, 'person card opens try-on studio');
  await page.click('a[aria-label="人體辨識結果"]');
  await page.waitForSelector('.specs');
  await page.click('button:has-text("重新辨識")');
  await page.waitForTimeout(300);
  await idle();
  ok(!(await page.locator('.alert-err').count()), 'offline re-analysis works');
  await ctx.setOffline(false);

  // 5. 新增衣服（真實 AI 去背）→ 虛擬試穿 → 調整 → 比較 → 儲存
  await page.goto(BASE + '#/wardrobe/new');
  await page.waitForSelector('.pick');
  await page.locator('input[type=file]:not([capture])').setInputFiles(path.join(PHOTOS, 'pollo-collared-tshirt-front.png'));
  await page.click('button:has-text("下一步：去背")');
  await page.waitForSelector('.cutout-stage');
  await idle();
  await page.click('button:has-text("完成去背")');
  await page.waitForSelector('.form');
  await page.waitForSelector('.ai-suggest', { timeout: 60000 }).catch(() => {});
  const sug = await page.locator('.ai-suggest').innerText().catch(() => '');
  ok(/T-shirt/.test(sug), `AI category suggestion for the T-shirt photo (${sug.replace(/\n/g, ' ')})`);
  await page.click('.chip-grid .chip >> text=T-shirt');
  await page.click('.owner-tab:has-text("小花")');
  await page.click('.sticky-actions >> text=儲存');
  await page.waitForSelector('.specs');
  await page.click('button:has-text("試穿這件")');
  await page.waitForSelector('text=本機合成', { timeout: 60000 });
  const ms1 = await page.locator('text=本機合成').innerText();
  ok(!(await page.locator('.alert-err').count()), `try-on composed (${ms1})`);
  const lastCompose = await page.evaluate(() => { try { const m = JSON.parse(localStorage.getItem('wardrobe-metrics-v1') || '{}'); return m.compose?.at(-1)?.detail ?? ''; } catch { return ''; } });
  ok(lastCompose && !lastCompose.includes('主執行緒'), `try-on composed in background worker (${lastCompose})`);
  await page.screenshot({ path: path.join(OUT, `${tag}-tryon.png`), fullPage: true });
  await page.click('button[role=tab]:has-text("手動調整")');
  await page.locator('.slider input').first().fill('1.15');
  await page.waitForTimeout(400);
  ok(/115%/.test(await page.locator('.slider').first().innerText()), 'size slider adjusts');
  const st = await page.locator('.cutout-stage canvas').boundingBox();
  await page.mouse.move(st.x + st.width / 2, st.y + st.height * 0.4); await page.mouse.down(); await page.mouse.move(st.x + st.width / 2 + 20, st.y + st.height * 0.4 + 10, { steps: 4 }); await page.mouse.up();
  await page.click('button[role=tab]:has-text("前後比較")');
  await page.mouse.click(st.x + st.width * 0.3, st.y + st.height / 2);
  await page.click('button:has-text("儲存試穿")');
  await page.waitForSelector('button:has-text("已儲存")');
  await page.goto(BASE + '#/outfits');
  await page.click('button[role=tab]:has-text("試穿紀錄")');
  await page.waitForSelector('.garment-card');
  ok((await page.locator('.garment-card').count()) === 1, 'saved try-on appears in history');

  // 6. 多件組合：新增長褲（合成圖，淺灰背景，經真實 AI 去背）→ 上衣 + 長褲 → 紮進 → 收藏穿搭 → 從收藏重新載入
  const pantsPng = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 1100; const x = c.getContext('2d');
    x.fillStyle = '#e8e8e8'; x.fillRect(0, 0, 600, 1100);
    x.fillStyle = '#2f4a78'; x.beginPath(); x.moveTo(160, 60); x.lineTo(440, 60); x.lineTo(450, 360); x.lineTo(460, 1040); x.lineTo(315, 1040); x.lineTo(300, 340); x.lineTo(285, 1040); x.lineTo(140, 1040); x.lineTo(150, 360); x.closePath(); x.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.goto(BASE + '#/wardrobe/new');
  await page.waitForSelector('.pick');
  await page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'pants.png', mimeType: 'image/png', buffer: Buffer.from(pantsPng, 'base64') });
  await page.click('button:has-text("下一步：去背")');
  await page.waitForSelector('.cutout-stage');
  await idle();
  await page.click('button:has-text("完成去背")');
  await page.waitForSelector('.form');
  await page.click('.chip-grid .chip >> text=長褲');
  await page.fill('input[placeholder^="例如"]', '測試長褲');
  await page.click('.sticky-actions >> text=儲存');
  await page.waitForSelector('.specs');
  await page.click('button:has-text("試穿這件")');
  await page.waitForSelector('text=本機合成', { timeout: 60000 });
  // 加入上衣（第一個非長褲的衣服）
  await page.locator('.strip-item:not(.on)').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.layers li').length === 3, null, { timeout: 30000 });
  ok(true, 'two garments layered (top + pants)');
  const order = await page.locator('.layers .layer-text small').allInnerTexts();
  ok(order.join(',') === '上衣,下身', `layer panel order outer→inner: ${order.join(',')}`);
  await page.click('.option:has-text("上衣紮進") input');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${tag}-outfit.png`), fullPage: true });
  await page.click('button:has-text("收藏穿搭")');
  await page.waitForSelector('button:has-text("已收藏")', { timeout: 30000 });
  await page.goto(BASE + '#/outfits');
  await page.click('button[role=tab]:has-text("收藏穿搭")');
  await page.waitForSelector('.garment-card');
  ok((await page.locator('.garment-card').count()) === 1, 'outfit saved to favourites');
  await page.click('.garment-card a');
  await page.waitForFunction(() => document.querySelectorAll('.layers li').length === 3, null, { timeout: 30000 });
  ok(await page.locator('.option:has-text("上衣紮進") input').isChecked(), 'outfit reloads with layers and tuck option');

  // 7. 穿搭推薦（本機規則引擎）：只用衣櫥裡的衣服 → 收藏 → 試穿
  await page.goto(BASE + '#/outfits?tab=recommend');
  await page.reload();
  await page.waitForSelector('.rec-card');
  const recText = await page.locator('.rec-card').first().innerText();
  console.log('  rec:', recText.replace(/\n+/g, ' | '));
  ok(/測試長褲/.test(recText), 'recommendation uses garments from the wardrobe');
  await page.locator('.rec-card button:has-text("收藏")').first().click();
  await page.waitForSelector('.rec-card button:has-text("已收藏")');
  await page.locator('.rec-card button:has-text("試穿")').first().click();
  await page.waitForURL(/#\/tryon\/studio\/[\w-]+\/g\//);
  await page.waitForFunction(() => document.querySelectorAll('.layers li').length >= 3, null, { timeout: 30000 });
  ok(true, 'recommended outfit opens in try-on studio with all pieces');
  await page.goto(BASE + '#/');
  await page.reload();
  await page.waitForSelector('.today', { timeout: 10000 }).catch(() => {});
  ok(await page.locator('.today').count() === 1, 'home shows today pick');

  // 情侶衣櫥：暱稱、自訂頭像（只存本機）、依擁有者篩選
  await page.goto(BASE + '#/settings');
  await page.fill('input[aria-label="她的暱稱"]', '一二');
  await page.fill('input[aria-label="他的暱稱"]', '布布');
  await page.locator('.couple-person').first().locator('input[type=file]').setInputFiles(path.join(PHOTOS, 'photo-02.jpg'));
  await page.waitForSelector('.crop-stage');
  await page.click('button:has-text("使用這個頭像")');
  await page.waitForSelector('.couple-person .avatar img', { timeout: 15000 });
  ok(await page.locator('.couple-person').first().locator('.avatar img').count() === 1, 'couple: custom avatar saved locally');
  await page.goto(BASE + '#/');
  await page.reload();
  await page.waitForFunction(() => /一二[\s\S]*布布/.test(document.querySelector('.hero')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => {});
  ok(/一二[\s\S]*布布/.test(await page.locator('.hero').innerText()), 'couple: names shown on home');
  await page.goto(BASE + '#/wardrobe');
  await page.click('.owner-tab:has-text("一二")');
  const herItems = await page.locator('.garment-card').count();
  await page.click('.owner-tab:has-text("布布")');
  const hisItems = await page.locator('.garment-card').count();
  await page.click('.owner-tab:has-text("全部")');
  const allItems = await page.locator('.garment-card').count();
  ok(herItems === allItems && hisItems === allItems - 1, `couple: owner filter (all ${allItems}, her ${herItems}, his ${hisItems})`);
  await page.screenshot({ path: path.join(OUT, `${tag}-couple-wardrobe.png`) });

  // 深色模式：手動切換、重新整理後保留
  await page.goto(BASE + '#/settings');
  await page.click('[aria-label="外觀"] button:has-text("深色")');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForSelector('[aria-label="外觀"]');
  const dark = await page.evaluate(() => ({ attr: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }));
  ok(dark.attr === 'dark' && dark.bg === 'rgb(23, 22, 42)', `dark mode applied and kept after reload (${dark.bg})`);
  await page.click('[aria-label="外觀"] button:has-text("跟隨系統")');

  // 8. 資料與隱私：CSP、用量、重複檢查、匯出
  ok(await page.evaluate(() => !!document.querySelector('meta[http-equiv="Content-Security-Policy"]')), 'CSP meta present in production build');
  await page.goto(BASE + '#/settings/data');
  await page.waitForSelector('.usage');
  console.log('  usage:', (await page.locator('.usage').innerText()).replace(/\s*\n\s*/g, ' | '));
  ok(/全身照/.test(await page.locator('.usage').innerText()), 'storage breakdown lists full-body photos');
  await page.click('button:has-text("開始檢查")');
  await page.waitForSelector('.dupes');
  console.log('  dupes:', (await page.locator('.dupes').innerText()).replace(/\n/g, ' | ').slice(0, 160));
  await page.click('button:has-text("匯出完整備份")');
  await page.waitForSelector('.backup-ready', { timeout: 60000 });
  console.log('  backup:', await page.locator('.backup-ready p').innerText());
  ok(true, 'full backup generated');

  // 9. 技術檢測頁兩個模型都能載入
  await page.goto(BASE + '#/settings/diagnostics');
  await page.waitForSelector('dl');
  await page.selectOption('select >> nth=1', 'wasm');
  await page.click('button:has-text("載入模型")');
  await page.waitForFunction(() => !document.querySelector('.status')?.textContent?.includes('⏳'), null, { timeout: 120000 });
  const log = await page.locator('.log').innerText();
  ok(/MoveNet 載入成功/.test(log) && /Selfie Segmenter 載入成功/.test(log), 'diagnostics: both models load');

  // 實機驗收頁：前面流程的真實耗時應已記錄
  await page.goto(BASE + '#/settings/acceptance');
  await page.waitForSelector('.accept-auto');
  const acc = await page.locator('main').innerText();
  ok(!/AI 去背（含首次載入模型）\n尚未使用/.test(acc) && !/AI 人體辨識\n尚未使用/.test(acc) && !/試穿合成（完整畫面）\n尚未使用/.test(acc), 'acceptance: on-device timings recorded');
  ok(/離線功能（Service Worker）\n✅/.test(acc), 'acceptance: SW active shown');
  await page.locator('.accept-item').first().locator('button:has-text("通過")').click();
  await page.locator('.accept-item').nth(1).locator('button:has-text("有問題")').click();
  await page.locator('.accept-item').nth(1).locator('input').fill('測試說明');
  await page.reload();
  await page.waitForSelector('.accept-item');
  ok((await page.locator('.accept-item').first().locator('.chip.on').innerText()) === '通過', 'acceptance: marks persist after reload');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.click('button:has-text("複製報告")');
  await page.waitForTimeout(500);
  const rep = await page.evaluate(() => navigator.clipboard.readText().catch(() => '')) || await page.locator('#report-text').inputValue();
  console.log('--- acceptance report\n' + rep);
  ok(/實機驗收報告/.test(rep) && /✅ 通過 用 Safari 開啟網址/.test(rep) && /說明：測試說明/.test(rep) && /AI 人體辨識：\d+ ms/.test(rep), 'acceptance: report text generated');

  // 一次新增多件：同一件 T-shirt（重複，應略過）＋一張新照片
  await page.goto(BASE + '#/wardrobe/batch');
  await page.waitForSelector('input[type=file][multiple]', { state: 'attached' });
  await page.locator('input[type=file][multiple]').setInputFiles([path.join(PHOTOS, 'pollo-collared-tshirt-front.png'), path.join(PHOTOS, 'photo-01.jpg')]);
  await page.waitForSelector('a.btn-primary:has-text("回到衣櫥")', { timeout: 180000 });
  const batch = await page.locator('.batch-list').innerText();
  console.log('  batch:', batch.replace(/\n+/g, ' | '));
  ok(/已經在衣櫥裡/.test(batch) && (await page.locator('.batch-row.added').count()) === 1, 'batch add: duplicate skipped, new photo added');
} catch (e) {
  ok(false, `exception: ${e.message.split('\n')[0]}`);
  console.log('  url:', page.url());
  console.log('  page:', (await page.locator('body').innerText().catch(() => '')).slice(0, 400).replace(/\n/g, ' | '));
  await page.screenshot({ path: path.join(OUT, `${tag}-error.png`), fullPage: true }).catch(() => {});
}
ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
