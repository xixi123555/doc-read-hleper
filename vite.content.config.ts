import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// 内容脚本独立构建：content script 必须以 IIFE 形式注入页面（隔离世界，不能使用 ESM import）
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
    sourcemap: false,
    minify: 'esbuild',
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'AIReaderContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
