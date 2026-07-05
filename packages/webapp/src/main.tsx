import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Telegram injects window.Telegram.WebApp via telegram-web-app.js (see index.html).
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
