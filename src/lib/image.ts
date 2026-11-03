/** 圖片處理：全部在本機瀏覽器完成。 */

export const LIMITS = {
  /** 原始圖片儲存上限（長邊 px） */
  originalMaxSide: 2048,
  /** 去背編輯與去背圖儲存上限 */
  cutoutMaxSide: 1280,
  thumbSide: 480,
  /** 選擇的檔案大小上限 */
  maxFileBytes: 40 * 1024 * 1024,
};

export type Canvas = OffscreenCanvas | HTMLCanvasElement;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings) {
  const x = c.getContext('2d', opts);
  if (!x) throw new Error('瀏覽器無法建立繪圖區（記憶體可能不足）');
  return x;
}

/** 讀取使用者選的照片，依 EXIF 轉正並限制尺寸。 */
export async function decodeImageFile(file: Blob, maxSide: number): Promise<ImageBitmap> {
  if (file.size > LIMITS.maxFileBytes) throw new Error('照片檔案太大（超過 40 MB）');
  if (file.type && !file.type.startsWith('image/')) throw new Error('請選擇圖片檔案');
  let probe: ImageBitmap;
  try {
    probe = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('無法讀取這張照片。iPhone 若為 HEIC 格式，請在「設定 → 相機 → 格式」選擇「最相容」，或改從相簿選擇。');
  }
  const scale = Math.min(1, maxSide / Math.max(probe.width, probe.height));
  if (scale === 1) return probe;
  const out = await createImageBitmap(probe, { resizeWidth: Math.round(probe.width * scale), resizeHeight: Math.round(probe.height * scale), resizeQuality: 'high' });
  probe.close();
  return out;
}

export function canvasToBlob(c: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片壓縮失敗（記憶體可能不足）'))), type, quality));
}

export function loadBlobImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

export async function sha256(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  if (!crypto.subtle) return `size-${blob.size}`; // 非安全來源時退化
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 不透明像素的外框（alpha > 阈值） */
export function alphaBBox(data: Uint8ClampedArray, w: number, h: number, thr = 16) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3]! > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 縮圖：圖片置中於淺灰底，JPEG。 */
export async function makeThumbnail(src: CanvasImageSource & { width: number; height: number }): Promise<Blob> {
  const S = LIMITS.thumbSide;
  const c = makeCanvas(S, Math.round(S * 4 / 3));
  const x = ctx2d(c);
  x.fillStyle = '#f4f4f5';
  x.fillRect(0, 0, c.width, c.height);
  const pad = 0.06;
  const scale = Math.min((c.width * (1 - 2 * pad)) / src.width, (c.height * (1 - 2 * pad)) / src.height);
  const w = src.width * scale, h = src.height * scale;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
  return canvasToBlob(c, 'image/jpeg', 0.85);
}

export const COLORS = [
  { label: '黑色', hex: '#111111' }, { label: '白色', hex: '#f7f7f5' }, { label: '灰色', hex: '#8e8e93' },
  { label: '米色', hex: '#e8dcc4' }, { label: '卡其', hex: '#b9a37e' }, { label: '咖啡', hex: '#6f4e37' },
  { label: '紅色', hex: '#c62828' }, { label: '酒紅', hex: '#7b1e3a' }, { label: '粉色', hex: '#f4a6c0' },
  { label: '橘色', hex: '#ef7d32' }, { label: '黃色', hex: '#f2c94c' }, { label: '綠色', hex: '#2e7d4f' },
  { label: '軍綠', hex: '#5b6236' }, { label: '藍色', hex: '#2f6fd1' }, { label: '海軍藍', hex: '#1f2a4d' },
  { label: '丹寧', hex: '#4a6a8f' }, { label: '紫色', hex: '#7e57c2' }, { label: '多色', hex: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' },
] as const;

/** 依不透明像素的平均色，猜最接近的預設顏色（Lab 距離近似）。 */
export function guessColor(data: Uint8ClampedArray): string {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) if (data[i + 3]! > 200) { r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++; }
  if (!n) return '';
  r /= n; g /= n; b /= n;
  let best = '', bd = Infinity;
  for (const c of COLORS) {
    if (!c.hex.startsWith('#')) continue;
    const [cr, cg, cb] = [1, 3, 5].map((o) => parseInt(c.hex.slice(o, o + 2), 16)) as [number, number, number];
    const rm = (r + cr) / 2;
    const d = (2 + rm / 256) * (r - cr) ** 2 + 4 * (g - cg) ** 2 + (2 + (255 - rm) / 256) * (b - cb) ** 2;
    if (d < bd) { bd = d; best = c.label; }
  }
  return best;
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
