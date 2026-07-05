import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls to the Hono server during local development.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
