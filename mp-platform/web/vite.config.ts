import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// mp-platform Vite 配置 (PoC Sprint 1 升级)
// - React 18 + Semi Design
// - dev 阶段 /api/* 代理到 admin-api.mjs (内部脚本, 端口 8081, 跨 mp-platform/web 边界)
// - 构建产物 dist/ 由 .gitignore 排除

export default defineConfig({
  root: '.',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8081',
        changeOrigin: false,
        ws: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          semi: ['@douyinfe/semi-ui', '@douyinfe/semi-icons'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
