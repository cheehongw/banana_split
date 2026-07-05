import { useEffect, useRef } from 'react';
import { telegram } from './telegram';

export interface MainButtonState {
  text: string;
  visible: boolean;
  enabled?: boolean; // default true
  progress?: boolean; // show the spinner
  onClick: () => void;
}

/**
 * Drive Telegram's native MainButton from React. Returns whether a MainButton is
 * available (false in a plain browser / dev), so screens can render an in-page
 * fallback button instead. The button is hidden automatically on unmount.
 */
export function useMainButton(state: MainButtonState): boolean {
  const mb = telegram()?.MainButton;
  const onClickRef = useRef(state.onClick);
  onClickRef.current = state.onClick;

  // Register a single stable click handler; the ref keeps it current.
  useEffect(() => {
    if (!mb) return;
    const handler = () => onClickRef.current();
    mb.onClick(handler);
    return () => {
      mb.offClick(handler);
      mb.hideProgress();
      mb.hide();
    };
  }, [mb]);

  // Sync visual state whenever it changes.
  useEffect(() => {
    if (!mb) return;
    mb.setText(state.text);
    if (state.visible) mb.show();
    else mb.hide();
    if (state.enabled === false) mb.disable();
    else mb.enable();
    if (state.progress) mb.showProgress();
    else mb.hideProgress();
  }, [mb, state.text, state.visible, state.enabled, state.progress]);

  return Boolean(mb);
}
