import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // PORT env override lets tooling pick a free port; 5173 is the default
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': {
        // 127.0.0.1, NOT localhost: the backend binds IPv4 only, and Node 17+
        // no longer reorders DNS results to prefer IPv4 — on an IPv6-first
        // host "localhost" resolves to ::1 and every proxied call ECONNREFUSEDs.
        target: `http://127.0.0.1:${Number(process.env.BACKEND_PORT) || 3001}`,
        changeOrigin: true,
      },
    },
  },
});
