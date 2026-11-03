/**
 * 下載 .tflite 模型到 public/models/（已 gitignore，不提交到 GitHub）。
 * 來源皆為 Google 官方、版本固定的網址，並驗證 SHA-256。
 * 用法：npm run fetch-models [-- --force]
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from './models.mjs';


const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
const force = process.argv.includes('--force');
await mkdir(outDir, { recursive: true });

for (const { file, url, sha256 } of MODELS) {
  const dest = path.join(outDir, file);
  if (!force && (await exists(dest))) {
    console.log(`略過 ${file}（已存在）`);
    report(file, await readFile(dest), sha256);
    continue;
  }
  process.stdout.write(`下載 ${file} ... `);
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error(`失敗：${e.cause?.message ?? e.message}`);
    process.exitCode = 1;
    continue;
  }
  if (!res.ok) {
    console.error(`失敗：HTTP ${res.status}`);
    process.exitCode = 1;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!report(file, buf, sha256)) {
    process.exitCode = 1;
    continue;
  }
  await writeFile(dest, buf);
}

function report(file, buf, expected) {
  const got = createHash('sha256').update(buf).digest('hex');
  console.log(`${file}: ${(buf.length / 1024).toFixed(0)} KB sha256=${got}`);
  if (expected && expected !== got) {
    console.error(`  ✗ SHA-256 不符！預期 ${expected}`);
    return false;
  }
  return true;
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}
