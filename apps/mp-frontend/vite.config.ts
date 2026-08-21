import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // 允许访问 workspace root (mp-frontend, apps/, observability/)
      // Vite 5 默认 fs.allow 严格, 不允许跳出 root
      allow: [
        'D:/Hermes/Workspace/10_Projects/MetaPlatform-Ontology',
      ],
    },
    port: 5174,
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      // 转发 API 请求到 Supabase Edge Functions / PostgREST
      '/api/supabase': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/supabase/, ''),
      },
      '/api/admin': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/admin/, ''),
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});