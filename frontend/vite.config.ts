import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // 统一 SPA：平台首页在 /，模块在 /diagram、/ppt
  base: '/',
  plugins: [react()],
  server: {
    port: 5173,
    // 端口被占用时直接报错，避免悄悄漂移到 5174 让人以为没起来
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // PPT 模块后端（FastAPI + LangGraph，端口 4000）
      '/ppt-api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ppt-api/, ''),
      },
    },
  },
})
