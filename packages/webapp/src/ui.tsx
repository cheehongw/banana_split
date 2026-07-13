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
      className="bs-button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '12px 16px',
        fontSize: 16,
        fontWeight: 600,
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
      <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: theme.hint, marginBottom: 6 }}>{label}</span>
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
      className={onClick ? 'bs-card bs-card--tappable' : 'bs-card'}
      onClick={onClick}
      style={{
        background: theme.secondaryBg,
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        boxShadow: 'var(--bs-shadow)',
      }}
    >
      {children}
    </div>
  );
}

/** A shimmering placeholder block for loading states. */
export function Skeleton({ height = 16, width = '100%', style }: { height?: number | string; width?: number | string; style?: CSSProperties }) {
  return <div className="bs-skeleton" style={{ height, width, ...style }} />;
}

/** A full-width card of shimmering lines, matching the Card silhouette. */
export function SkeletonCard() {
  return (
    <div style={{ background: theme.secondaryBg, borderRadius: 12, padding: 14, marginBottom: 10 }}>
      <Skeleton height={16} width="55%" />
      <Skeleton height={12} width="35%" style={{ marginTop: 8 }} />
    </div>
  );
}

/** A friendly, centered empty state with an emoji, title, and optional hint. */
export function EmptyState({ emoji, title, hint }: { emoji: string; title: string; hint?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 16px', color: theme.hint }}>
      <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 10 }}>{emoji}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 14, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

/** Section header — consistent size/weight/spacing across screens. */
export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 13,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: theme.hint,
        margin: '24px 0 10px',
      }}
    >
      {children}
    </h2>
  );
}

/** A stacked icon-over-label action tile. Equal width, single-line label — so a
 * row of them stays visually uniform regardless of label length. */
export function QuickAction({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }) {
  return (
    <button
      className="bs-button"
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '10px 8px',
        borderRadius: 10,
        border: `1px solid ${theme.hint}`,
        background: 'transparent',
        color: theme.text,
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
        }}
      >
        {label}
      </span>
    </button>
  );
}
