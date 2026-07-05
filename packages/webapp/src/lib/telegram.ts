// telegram-web-app.js injects a stub `window.Telegram.WebApp` even in a plain
// browser, where its MainButton/BackButton are no-ops that never render. Detect
// a *real* Telegram host (it reports a concrete `platform`) so screens can fall
// back to in-page buttons when we're not actually inside Telegram.
export function telegram(): TelegramWebApp | undefined {
  const tg = window.Telegram?.WebApp;
  if (!tg || !tg.platform || tg.platform === 'unknown') return undefined;
  return tg;
}

export function isTelegram(): boolean {
  return telegram() !== undefined;
}
