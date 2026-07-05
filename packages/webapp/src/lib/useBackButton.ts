import { useEffect, useRef } from 'react';
import { telegram } from './telegram';

/**
 * Drive Telegram's native BackButton from React. Pass the back handler (or null
 * to hide it, e.g. on the root screen). Returns whether a BackButton is available
 * so callers can render an in-page fallback when it isn't (plain browser / dev).
 */
export function useBackButton(onBack: (() => void) | null): boolean {
  const bb = telegram()?.BackButton;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!bb) return;
    const handler = () => onBackRef.current?.();
    bb.onClick(handler);
    return () => {
      bb.offClick(handler);
      bb.hide();
    };
  }, [bb]);

  useEffect(() => {
    if (!bb) return;
    if (onBack) bb.show();
    else bb.hide();
  }, [bb, onBack]);

  return Boolean(bb);
}
