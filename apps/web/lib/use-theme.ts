'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

// one theme for every page, light unless the reader chose otherwise
export function useTheme() {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    const saved = window.localStorage.getItem('fork-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);
  const toggle = useCallback(
    () =>
      setTheme((current) => {
        const next = current === 'dark' ? 'light' : 'dark';
        window.localStorage.setItem('fork-theme', next);
        return next;
      }),
    [],
  );
  return { theme, toggle };
}
