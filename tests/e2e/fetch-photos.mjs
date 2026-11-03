/**
 * 下載 E2E 測試照片（不提交到 Git）。來源：pravoobi/try-on 固定版本中的
 * Wikimedia Commons 照片（CC BY 2.0 / 公有領域，出處見該 repo 的 ATTRIBUTION.md）。
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REF = 'https://raw.githubusercontent.com/pravoobi/try-on/b14a99966eca0317b29fd50d3c49290e1b0cf8c6';
const FILES = ['public/test-photos/photo-01.jpg', 'public/test-photos/photo-02.jpg', 'public/test-photos/photo-03.jpg', 'tools/raw-garments/pollo-collared-tshirt-front.png'];
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.photos');
await mkdir(dir, { recursive: true });
for (const f of FILES) {
  const dest = path.join(dir, path.basename(f));
  try { await access(dest); continue; } catch { /* download */ }
  const r = await fetch(`${REF}/${f}`);
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  await writeFile(dest, Buffer.from(await r.arrayBuffer()));
  console.log('downloaded', path.basename(f));
}
