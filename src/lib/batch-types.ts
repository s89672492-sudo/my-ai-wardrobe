import type { CutoutMethod, JudgeMethod } from './types';

/** 一次新增多件（add）或重新處理舊衣服（redo）的工作 */
export interface BatchJob {
  id: 'current';
  kind: 'add' | 'redo';
  createdAt: number;
  /** 使用者按下「開始」後才會處理（之前還能改設定） */
  started: boolean;
  cutout: CutoutMethod;
  judge: JudgeMethod;
  /** 重新處理：要不要重新去背、重新判斷 */
  redoCutout: boolean;
  redoJudge: boolean;
  total: number;
}

export interface BatchJobItem {
  id: string;
  jobId: 'current';
  /** 處理順序 */
  index: number;
  /** add：壓縮後的照片與原始檔雜湊；redo：衣服 ID */
  photo?: Blob;
  hash?: string;
  garmentId?: string;
  status: 'pending' | 'added' | 'updated' | 'duplicate' | 'error';
  /** 處理後的衣服（added／updated／duplicate） */
  resultId?: string;
  message?: string;
  /** 是否有用到 AI 判斷、去背是否成功 */
  judged?: 'gemini' | 'local' | 'none';
  cutoutOk?: boolean;
}
