'use client';

import { useEffect, useState } from 'react';

/** 跟随 <html> 的 .dark/.light 类，返回当前主题（供 Toaster 等非 CSS 变量驱动的组件使用）。 */
export function useHtmlTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setTheme(el.classList.contains('light') ? 'light' : 'dark');
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}
