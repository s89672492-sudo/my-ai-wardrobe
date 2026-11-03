/**
 * 下載 .tflite 模型到 public/models/（已 gitignore，不提交到 GitHub）。
 * 來源皆為 Google 官方、版本固定的網址，並驗證 SHA-256。
 * 用法：npm run fetch-models [-- --force]
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = [
  {
    file: 'selfie_segmenter.tflite',
    // MediaPipe Selfie Segmenter（正方形 256×256），版本 1，Apache-2.0
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
    sha256: '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b',
  },
  {
    file: 'movenet_singlepose_lightning.tflite',
    // MoveNet SinglePose Lightning float16 v4，Apache-2.0（tfhub 會轉址到 Kaggle）
    url: 'https://tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/float16/4?lite-format=tflite',
    sha256: '0fac2226112d0371903ca86e3853cec24ef603a0b2f96f589b180f0ebdd135ab', // 2026-11-03 CI 首次下載鎖定
  },
  {
    file: 'magic_touch.tflite',
    // MediaPipe Interactive Segmenter（MagicTouch）float32 版本 1，Apache-2.0；衣服 AI 去背
    url: 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite',
    sha256: 'e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25',
  },
];

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
