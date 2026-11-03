/** 主執行緒 ↔ AI Worker 的訊息協定。 */
export type Accelerator = 'webgpu' | 'wasm';
export type ModelName = 'segmenter' | 'pose' | 'magicTouch';

export interface Keypoint { name: string; x: number; y: number; score: number }

export type WorkerRequest =
  | { type: 'init'; id: number; wasmPath: string; cacheName: string; accelerator: Accelerator; models: Partial<Record<ModelName, string>> }
  | { type: 'process'; id: number; bitmap: ImageBitmap; tasks: ModelName[] }
  /** 點選式去背：points 為 0~1 正規化座標，每個點各推論一次後取聯集 */
  | { type: 'cutout'; id: number; bitmap: ImageBitmap; points: { x: number; y: number }[] }
  /** 全身分析：姿勢 → 依人體範圍裁切 → 第二次姿勢 + 分割（提高解析度） */
  | { type: 'analyze'; id: number; bitmap: ImageBitmap; /** 已知關鍵點（例如手動校正後重新分割）：略過姿勢推論 */ keypointsHint?: Keypoint[] }
  | { type: 'cancel'; id: number; targetId: number }
  | { type: 'dispose'; id: number };

export interface ModelLoadInfo { name: ModelName; ok: boolean; ms: number; error?: string; input?: string; output?: string }

export type WorkerResponse =
  | { type: 'ready'; id: number; backend: Accelerator; requested: Accelerator; jspi: boolean; relaxedSimd: boolean; runtimeMs: number; models: ModelLoadInfo[]; fallbackReason?: string }
  | { type: 'progress'; id: number; stage: string }
  | {
      type: 'result'; id: number;
      keypoints?: Keypoint[];
      mask?: { bitmap: ImageBitmap; width: number; height: number };
      timings: { poseMs?: number; segmentMs?: number; totalMs: number };
    }
  | { type: 'cutoutResult'; id: number; mask: ImageBitmap; ms: number }
  | {
      type: 'analyzeResult'; id: number;
      keypoints: Keypoint[];
      /** 人體遮罩（白色 + alpha），對應原圖中的 maskRect 區域 */
      mask: ImageBitmap;
      maskRect: { x: number; y: number; w: number; h: number };
      timings: { pass1Ms: number; pass2Ms: number; segmentMs: number; totalMs: number };
      refined: boolean;
    }
  | { type: 'cancelled'; id: number }
  | { type: 'disposed'; id: number }
  | { type: 'error'; id: number; message: string; stage: string };

export const KEYPOINT_NAMES = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
] as const;
