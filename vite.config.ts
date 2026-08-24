import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// 主构建：popup / chat / translate 三个扩展页面 + background service worker（ESM）
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    // Service Worker 中没有 window/document，禁用 Vite 注入的 modulepreload polyfill
    // （Chrome 90+ 原生支持 modulepreload，polyfill 仅对旧浏览器有意义）
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        chat: resolve(__dirname, 'chat.html'),
        translate: resolve(__dirname, 'translate.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        // 所有编译产物（入口 JS / 共享 chunk / CSS 等资源）均带内容指纹
        entryFileNames: 'js/[name]-[hash].js',
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
