// Explicit light/dark override on top of Telegram's theme. Our ui.tsx `theme`
// object reads `var(--tg-theme-*)`, so overriding those variables on :root
// re-styles the whole app live (CSS cascade) without a React re-render.

export type ThemeMode = 'auto' | 'light' | 'dark';

const KEY = 'bs_theme_mode';

const LIGHT: Record<string, string> = {
  '--tg-theme-bg-color': '#ffffff',
  '--tg-theme-secondary-bg-color': '#f1f1f4',
  '--tg-theme-text-color': '#000000',
  '--tg-theme-hint-color': '#8e8e93',
  '--tg-theme-link-color': '#2481cc',
  '--tg-theme-button-color': '#2481cc',
  '--tg-theme-button-text-color': '#ffffff',
  '--tg-theme-destructive-text-color': '#d7263d',
};

const DARK: Record<string, string> = {
  '--tg-theme-bg-color': '#17212b',
  '--tg-theme-secondary-bg-color': '#232e3c',
  '--tg-theme-text-color': '#ffffff',
  '--tg-theme-hint-color': '#7d8b99',
  '--tg-theme-link-color': '#5eb5f7',
  '--tg-theme-button-color': '#50a8eb',
  '--tg-theme-button-text-color': '#ffffff',
  '--tg-theme-destructive-text-color': '#ec3942',
};

export function getThemeMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(KEY, mode);
  applyThemeMode(mode);
}

export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  const palette = mode === 'dark' ? DARK : mode === 'light' ? LIGHT : null;
  if (!palette) {
    // auto: drop overrides so Telegram's injected vars (or ui fallbacks) win.
    for (const k of Object.keys(LIGHT)) root.style.removeProperty(k);
    return;
  }
  for (const [k, v] of Object.entries(palette)) root.style.setProperty(k, v);
}
