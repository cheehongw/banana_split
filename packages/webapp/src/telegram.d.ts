// Typings for the Telegram Mini App bridge (telegram-web-app.js). Expanded as we
// use more of the surface; lean on @telegram-apps/sdk-react for anything richer.

interface TelegramMainButton {
  text: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  setText(text: string): void;
  show(): void;
  hide(): void;
  enable(): void;
  disable(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

interface TelegramInitDataUnsafe {
  user?: TelegramWebAppUser;
  /** The `startapp=` value from a direct Mini App link (we pass the group id). */
  start_param?: string;
  [key: string]: unknown;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: TelegramInitDataUnsafe;
  platform: string; // 'ios' | 'android' | 'tdesktop' | … | 'unknown' (not in Telegram)
  version: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready(): void;
  expand(): void;
  close(): void;
  MainButton: TelegramMainButton;
  BackButton: TelegramBackButton;
}

interface Window {
  Telegram?: { WebApp: TelegramWebApp };
}
