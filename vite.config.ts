import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };
import { cspPlugin } from './vite.csp';
import { pagesPlugin } from './vite.pages';

// GitHub Pages 專案網址為 /<repo>/；CI 以 BASE_PATH 傳入，本機開發維持 /
export default defineConfig(({ mode }) => {
  const base = mode === 'production' ? (process.env.BASE_PATH ?? '/my-ai-wardrobe/') : '/';
  // 建置代號：CI 用 commit SHA，讓手機上可以確認是否已更新到最新部署
  const build = (process.env.GITHUB_SHA ?? 'local').slice(0, 7);
  return {
    base,
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(build), __LITERT_VERSION__: JSON.stringify(pkg.dependencies['@litertjs/core']) },
    plugins: [
      react(),
      cspPlugin(),
      pagesPlugin(base, pkg.version, build),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
        manifest: {
          id: base,
          name: 'My AI Wardrobe 智慧衣櫥',
          short_name: 'AI 衣櫥',
          description: '完全在手機本機運算的 AI 智慧衣櫥與虛擬試穿',
          lang: 'zh-Hant-TW',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#ffffff',
          theme_color: '#ffffff',
          categories: ['lifestyle', 'shopping'],
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // App 本體預先快取；AI 模型與 wasm 體積大，改為首次使用時才快取
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          globIgnores: ['litert-wasm/**', 'models/**'],
          navigateFallback: `${base}index.html`,
          cleanupOutdatedCaches: true,
          // AI 模型與 wasm 由 AI Worker 自行存入 Cache Storage（見 src/ai/inference.worker.ts）
        },
      }),
    ],
    worker: { format: 'es' },
    server: { host: true, port: 5173 },
  };
});
