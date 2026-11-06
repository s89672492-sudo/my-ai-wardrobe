import type { BodyAnalysis } from '../ai/body';
import type { Layer } from './compose';
import type { P2 } from './tps';

export interface ComposeLayerMsg extends Omit<Layer, 'image'> { key: string }

export type ComposeWorkerRequest =
  | { type: 'person'; photo: ImageBitmap; mask: ImageBitmap | null; parse: ImageBitmap | null; analysis: BodyAnalysis }
  | { type: 'garment'; key: string; image: ImageBitmap }
  | { type: 'forget'; keys: string[] }
  | {
      type: 'compose'; id: number; layers: ComposeLayerMsg[]; draft?: boolean; showAnchors?: boolean;
      grid?: { cols: number; rows: number }; draftGrid?: { cols: number; rows: number }; shading?: number; eraseOld?: boolean;
    };

export type ComposeWorkerResponse =
  | { type: 'composed'; id: number; bitmap: ImageBitmap; notes: string[]; ms: number; anchors: { id: string; dst: P2[]; labels: string[] }[] }
  | { type: 'error'; id: number; message: string };
