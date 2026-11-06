import { lazy, Suspense } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { cleanupOldAICaches } from './ai/assets';
import { bodyBusy, releaseBodyModels } from './ai/body-client';
import { cutoutBusy, releaseCutoutModel } from './ai/cutout';
import { AIStatusPill } from './components/AIStatusPill';
import { watchBattery } from './lib/compute';
import { useEffect } from 'react';
import { BottomNav } from './components/BottomNav';
import { Icon } from './components/Icon';
import { useOnline } from './lib/platform';
import { useRoute } from './lib/router';
import { SettingsProvider } from './lib/settings';
import { Home } from './pages/Home';
import { Outfits } from './pages/Outfits';
import { Settings } from './pages/Settings';
import { TryOn } from './pages/TryOn';
import { Wardrobe } from './pages/Wardrobe';
import { GarmentDetail } from './pages/GarmentDetail';
import { GarmentEditor } from './pages/GarmentEditor';
import { PersonPage } from './pages/PersonPage';
import { DataPage } from './pages/DataPage';
import { BatchAdd } from './pages/BatchAdd';
import { Acceptance } from './pages/Acceptance';
import { TryOnStudio } from './pages/TryOnStudio';

// 技術檢測頁較大，延遲載入
void cleanupOldAICaches();
watchBattery();

/** App 進入背景 30 秒後，釋放閒置中的 AI 模型記憶體（iPhone 會優先關掉記憶體用量大的背景網頁） */
function useBackgroundRelease() {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      clearTimeout(t);
      if (document.visibilityState === 'hidden') t = setTimeout(() => {
        if (!cutoutBusy()) void releaseCutoutModel();
        if (!bodyBusy()) void releaseBodyModels();
      }, 30_000);
    };
    document.addEventListener('visibilitychange', on);
    return () => { document.removeEventListener('visibilitychange', on); clearTimeout(t); };
  }, []);
}

/**
 * 主動檢查新版本：加入主畫面的 App 在 iPhone 上可能長時間不重新載入，
 * 只靠瀏覽器自動檢查常會一直停在舊版。回到 App 時與每小時檢查一次（只抓 sw.js，很小）。
 */
function watchForUpdates(_url: string, r: ServiceWorkerRegistration | undefined) {
  if (!r) return;
  let last = Date.now();
  const check = () => {
    if (!navigator.onLine || r.installing || Date.now() - last < 60_000) return;
    last = Date.now();
    void r.update().catch(() => { /* 離線或伺服器暫時無回應，下次再試 */ });
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(check, 60 * 60_000);
}

const Diagnostics = lazy(() => import('./pages/Diagnostics').then((m) => ({ default: m.Diagnostics })));

export default function App() {
  const route = useRoute();
  const online = useOnline();
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({ onRegisteredSW: watchForUpdates });
  useBackgroundRelease();

  return (
    <SettingsProvider>
      {!online && <div className="offline-bar"><Icon name="wifiOff" size={16} /> 目前離線，衣櫥與已下載的 AI 仍可使用</div>}
      <AIStatusPill />
      <main className="app-main" key={route.name} data-route={route.name}>
        {route.name === 'home' && <Home />}
        {route.name === 'wardrobe' && <Wardrobe />}
        {route.name === 'garment-new' && <GarmentEditor key="new" />}
        {route.name === 'garment-batch' && <BatchAdd />}
        {route.name === 'garment' && <GarmentDetail key={route.id} id={route.id} />}
        {route.name === 'garment-edit' && <GarmentEditor key={`edit-${route.id}`} id={route.id} />}
        {route.name === 'tryon' && <TryOn />}
        {route.name === 'person-new' && <PersonPage key="new" />}
        {route.name === 'person' && <PersonPage key={route.id} id={route.id} />}
        {route.name === 'studio' && <TryOnStudio key={`${route.personId}-${route.outfitId ?? ''}-${route.garmentIds?.join(',') ?? ''}`} personId={route.personId} garmentId={route.garmentId} outfitId={route.outfitId} garmentIds={route.garmentIds} />}
        {route.name === 'outfits' && <Outfits />}
        {route.name === 'settings' && <Settings />}
        {route.name === 'data' && <DataPage />}
        {route.name === 'acceptance' && <Acceptance />}
        {route.name === 'diagnostics' && <Suspense fallback={<p className="page muted">載入中…</p>}><Diagnostics /></Suspense>}
      </main>
      {needRefresh && (
        <div className="toast" role="status">
          <span>有新版本可以使用</span>
          <button className="btn btn-small btn-primary" onClick={() => void updateServiceWorker(true)}>更新</button>
        </div>
      )}
      {!['garment-new', 'garment-edit', 'garment-batch'].includes(route.name) && <BottomNav route={route} />}
    </SettingsProvider>
  );
}
