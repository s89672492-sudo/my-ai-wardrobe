import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { applySavedTheme } from './lib/settings';

applySavedTheme();

// 沒有 # 的深層網址（例如 /my-ai-wardrobe/wardrobe，由 404.html 或離線時的 Service Worker 回應）
// 轉成 hash 路由網址，避免重新整理或加入主畫面後找不到頁面
{
  const base = import.meta.env.BASE_URL;
  const p = location.pathname;
  if (p.startsWith(base) && p !== base) {
    const rest = p.slice(base.length).replace(/\/+$/, '');
    history.replaceState(null, '', base + (rest && rest !== 'index.html' ? `#/${rest}` : location.hash));
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
