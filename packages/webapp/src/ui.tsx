import type { CSSProperties, ReactNode } from 'react';
import { useBackButton } from './lib/useBackButton';

// Telegram's telegram-web-app.js sets --tg-theme-* CSS variables on the page.
// We lean on them with sensible light-mode fallbacks so the app looks native.
export const theme = {
  bg: 'var(--tg-theme-bg-color, #ffffff)',
  secondaryBg: 'var(--tg-theme-secondary-bg-color, #f1f1f4)',
  text: 'var(--tg-theme-text-color, #000000)',
  hint: 'var(--tg-theme-hint-color, #8e8e93)',
  link: 'var(--tg-theme-link-color, #2481cc)',
  button: 'var(--tg-theme-button-color, #2481cc)',
  buttonText: 'var(--tg-theme-button-text-color, #ffffff)',
  destructive: 'var(--tg-theme-destructive-text-color, #d7263d)',
};

export function Screen({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) {
  // Use Telegram's native BackButton when available; fall back to an in-page link.
  const hasBackButton = useBackButton(onBack ?? null);
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        background: theme.bg,
        color: theme.text,
        minHeight: '100vh',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        {onBack && !hasBackButton && (
          <button onClick={onBack} style={{ ...linkButtonStyle, fontSize: 17 }} aria-label="Back">
            ‹ Back
          </button>
        )}
        <h1 style={{ fontSize: 22, margin: 0 }}>{title}</h1>
      </header>
      {children}
    </main>
  );
}

const linkButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: theme.link,
  padding: 0,
  cursor: 'pointer',
};

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const primary = variant === 'primary';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '12px 16px',
        fontSize: 16,
        borderRadius: 10,
        border: primary ? 'none' : `1px solid ${theme.hint}`,
        background: primary ? theme.button : 'transparent',
        color: primary ? theme.buttonText : theme.text,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 13, color: theme.hint, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 16,
  borderRadius: 10,
  border: `1px solid ${theme.hint}`,
  background: theme.bg,
  color: theme.text,
  boxSizing: 'border-box',
};

export function Card({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: theme.secondaryBg,
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {children}
    </div>
  );
}
