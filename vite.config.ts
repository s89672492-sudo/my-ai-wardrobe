import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 專案網址為 /<repo>/，用環境變數設定，本機開發維持 /
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? (process.env.BASE_PATH ?? '/my-ai-wardrobe/') : '/',
  plugins: [react()],
  worker: { format: 'es' },
  server: { host: true, port: 5173 },
}));
