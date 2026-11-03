import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadSettings, saveSettings } from './db';
import { DEFAULT_SETTINGS, type AppSettings } from './types';

interface Ctx { settings: AppSettings; update: (p: Partial<AppSettings>) => Promise<void>; error: string | null }
const SettingsContext = createContext<Ctx>({ settings: DEFAULT_SETTINGS, update: async () => {}, error: null });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadSettings().then(setSettings, (e: Error) => setError(e.message)); }, []);
  const update = useCallback(async (p: Partial<AppSettings>) => {
    const next = { ...settings, ...p };
    setSettings(next);
    try { await saveSettings(next); setError(null); } catch (e) { setError((e as Error).message); }
  }, [settings]);
  return <SettingsContext.Provider value={{ settings, update, error }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
