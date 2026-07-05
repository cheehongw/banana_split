// Minimal typings for the Telegram Mini App bridge exposed by telegram-web-app.js.
// Expand as needed, or lean on @telegram-apps/sdk-react for richer bindings.
interface TelegramWebApp {
  initData: string;
  initDataUnsafe: Record<string, unknown>;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready(): void;
  expand(): void;
  close(): void;
  MainButton: {
    setText(text: string): void;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
  };
}

interface Window {
  Telegram?: { WebApp: TelegramWebApp };
}
