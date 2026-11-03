/**
 * 新版本更新流程：已安裝的 App 回到前景時偵測到新部署 → 顯示「有新版本」→ 按更新後換成新版。
 * 需先啟動 node tools/serve-pages.mjs 4174；本測試會重新建置 dist（兩個不同部署代號）。
 */
import { chromium, devices } from 'playwright';
import { execSync } from 'node:child_process';

const B = 'http://localhost:4174/my-ai-wardrobe/';
const build = (sha) => execSync('npm run -s build', { env: { ...process.env, GITHUB_SHA: sha }, stdio: 'ignore' });
const ver = async (p) => (await p.locator('main').innerText()).match(/版本 [\d.]+（(\w+)）/)?.[1];
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failed++; };

build('aaaaaaa000');
const b = await chromium.launch();
try {
  const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  await p.goto(B + '#/settings');
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  ok((await ver(p)) === 'aaaaaaa', '舊版 aaaaaaa 已安裝');
  build('bbbbbbb000');
  // 模擬過了一段時間後回到 App
  await p.evaluate(() => { const n = Date.now; Date.now = () => n() + 120_000; document.dispatchEvent(new Event('visibilitychange')); });
  const shown = await p.waitForSelector('.toast:has-text("有新版本")', { timeout: 30000 }).then(() => true, () => false);
  ok(shown, '回到 App 時偵測到新版本並顯示提示');
  ok((await ver(p)) === 'aaaaaaa', '使用者按更新前不會被強制換版（避免編輯到一半資料遺失）');
  if (shown) await Promise.all([p.waitForNavigation(), p.click('.toast button:has-text("更新")')]);
  await p.goto(B + '#/settings');
  await p.waitForSelector('main');
  ok((await ver(p)) === 'bbbbbbb', '按「更新」後換成新版 bbbbbbb');
} catch (e) { ok(false, `例外：${e.message}`); }
await b.close();
build(process.env.GITHUB_SHA ?? 'local');
process.exit(failed ? 1 : 0);
