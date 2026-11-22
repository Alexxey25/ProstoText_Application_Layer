import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: Number(process.env.CLIENT_PORT) || 5173, strictPort: true, proxy: {
  '/api': { target: `http://127.0.0.1:${process.env.PORT || 8000}`, rewrite: p => p.replace(/^\/api/, ''), timeout: 0, proxyTimeout: 0 },
} } });
