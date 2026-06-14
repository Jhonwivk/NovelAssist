'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const cur = (document.documentElement.classList.contains('light') ? 'light' : 'dark') as 'dark' | 'light';
    setTheme(cur);
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(next);
    try {
      localStorage.setItem('na-theme', next);
    } catch {
      /* ignore */
    }
  }

  return (
    <Button variant="ghost" onClick={toggle} className="px-2" title="切换主题">
      {theme === 'dark' ? '☀️' : '🌙'}
    </Button>
  );
}
