import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadSettings, saveSettings } from './db';
import { setImageProfile } from './image';
import { DEFAULT_SETTINGS, type AppSettings } from './types';

interface Ctx { settings: AppSettings; update: (p: Partial<AppSettings>) => Promise<void>; error: string | null }
const SettingsContext = createContext<Ctx>({ settings: DEFAULT_SETTINGS, update: async () => {}, error: null });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { loadSettings().then((v) => { setSettings(v); setLoaded(true); }, (e: Error) => setError(e.message)); }, []);
  useEffect(() => { setImageProfile(settings.imageQuality); }, [settings.imageQuality]);
  // 設定讀完才套用；之前沿用 main.tsx 從 localStorage 預先套用的外觀（避免閃一下淺色）
  useEffect(() => { if (loaded) applyTheme(settings.theme ?? 'auto'); }, [loaded, settings.theme]);
  const update = useCallback(async (p: Partial<AppSettings>) => {
    const next = { ...settings, ...p };
    setSettings(next);
    try { await saveSettings(next); setError(null); } catch (e) { setError((e as Error).message); }
  }, [settings]);
  return <SettingsContext.Provider value={{ settings, update, error }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

const THEME_KEY = 'wardrobe-theme';
/** 套用外觀；同時記在 localStorage，下次開啟時在畫面出現前就套用（避免先閃一下淺色） */
export function applyTheme(t: 'auto' | 'light' | 'dark') {
  const root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#17162a' : '#eef3fb');
}
export function applySavedTheme() {
  let t: string | null = null;
  try { t = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  applyTheme(t === 'light' || t === 'dark' ? t : 'auto');
}
