/** AI 模型清單：版本固定的官方下載網址與 SHA-256（fetch-models 與 verify-dist 共用） */
export const MODELS = [
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
