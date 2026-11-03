import { lazy, Suspense } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { cleanupOldAICaches } from './ai/assets';
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

// 技術檢測頁較大，延遲載入
void cleanupOldAICaches();

const Diagnostics = lazy(() => import('./pages/Diagnostics').then((m) => ({ default: m.Diagnostics })));

export default function App() {
  const route = useRoute();
  const online = useOnline();
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  return (
    <SettingsProvider>
      {!online && <div className="offline-bar"><Icon name="wifiOff" size={16} /> 目前離線，衣櫥與已下載的 AI 仍可使用</div>}
      <main className="app-main">
        {route.name === 'home' && <Home />}
        {route.name === 'wardrobe' && <Wardrobe />}
        {route.name === 'garment-new' && <GarmentEditor key="new" />}
        {route.name === 'garment' && <GarmentDetail key={route.id} id={route.id} />}
        {route.name === 'garment-edit' && <GarmentEditor key={`edit-${route.id}`} id={route.id} />}
        {route.name === 'tryon' && <TryOn />}
        {route.name === 'outfits' && <Outfits />}
        {route.name === 'settings' && <Settings />}
        {route.name === 'diagnostics' && <Suspense fallback={<p className="page muted">載入中…</p>}><Diagnostics /></Suspense>}
      </main>
      {needRefresh && (
        <div className="toast" role="status">
          <span>有新版本可以使用</span>
          <button className="btn btn-small btn-primary" onClick={() => void updateServiceWorker(true)}>更新</button>
        </div>
      )}
      {!['garment-new', 'garment-edit'].includes(route.name) && <BottomNav route={route} />}
    </SettingsProvider>
  );
}
