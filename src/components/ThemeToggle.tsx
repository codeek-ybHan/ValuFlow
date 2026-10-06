import { useEffect, useState } from 'react';
import { IconMonitor, IconMoon, IconSun } from './Icons';

type Theme = 'light' | 'dark' | 'system';
const KEY = 'valuflow:theme';
const OPTIONS: { v: Theme; label: string; icon: JSX.Element }[] = [
  { v: 'light', label: '라이트', icon: <IconSun /> },
  { v: 'dark', label: '다크', icon: <IconMoon /> },
  { v: 'system', label: '시스템', icon: <IconMonitor /> },
];

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  return 'system';
}

export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    applyTheme(theme);
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch { /* ignore */ }
  }, [theme]);
  return (
    <div className="theme-toggle" role="group" aria-label="화면 테마">
      {OPTIONS.map((o) => (
        <button key={o.v} aria-pressed={theme === o.v} aria-label={o.label} title={o.label} onClick={() => setTheme(o.v)}>{o.icon}</button>
      ))}
    </div>
  );
}
