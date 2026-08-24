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
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        // 产物带内容指纹（manifest 由 postbuild 按实际文件名重写）
        entryFileNames: 'js/content-[hash].js',
        format: 'iife',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
