import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyThemeMode, getThemeMode } from './lib/theme';
import './styles.css';

// Telegram injects window.Telegram.WebApp via telegram-web-app.js (see index.html).
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

// Apply any saved light/dark override before first paint.
applyThemeMode(getThemeMode());

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
