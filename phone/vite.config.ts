import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The phone app: a static site for GitHub Pages (https://mihirh19.github.io/investment_analysis/).
export default defineConfig({
  root: resolve(__dirname),
  base: '/investment_analysis/',
  resolve: { alias: { '@shared': resolve(__dirname, '../src/shared') } },
  plugins: [react(), tailwindcss()],
  build: { outDir: resolve(__dirname, '../dist-phone'), emptyOutDir: true, target: 'safari16' }
})
