/**
 * 檢查 Git 追蹤的檔案：不得提交私人照片、AI 模型權重或大型檔案。
 * 用法：npm run check-repo（CI 每次推送都會執行）
 */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const ICONS = /^public\/icons\/(icon-192|icon-512|icon-maskable-512|apple-touch-icon)\.png$|^public\/icons\/favicon\.svg$/;
const IMAGE = /\.(jpe?g|png|webp|heic|heif|gif|avif|bmp|tiff?|dng|raw)$/i;
const WEIGHTS = /\.(tflite|task|onnx|bin|pb|h5|safetensors|ckpt|pt|pth|wasm)$/i;
const problems = [];
for (const f of files) {
  if (IMAGE.test(f) && !ICONS.test(f)) problems.push(`圖片檔（可能是私人照片）：${f}`);
  if (WEIGHTS.test(f)) problems.push(`模型權重或 wasm（應在建置時下載）：${f}`);
  const size = statSync(f, { throwIfNoEntry: false })?.size ?? 0;
  if (size > 1024 * 1024 && f !== 'package-lock.json') problems.push(`超過 1 MB 的檔案：${f}（${(size / 1024 / 1024).toFixed(1)} MB）`);
}
if (problems.length) {
  console.error('✗ 儲存庫檢查失敗：\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✓ 儲存庫檢查通過：${files.length} 個追蹤檔案中沒有私人照片、模型權重或大型檔案（只有 5 個 App 圖示）`);
