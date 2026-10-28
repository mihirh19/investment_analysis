import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      // The spreadsheet reader runs as its own process (src/main/sheets/worker.ts).
      rollupOptions: { input: { index: resolve('src/main/index.ts'), sheets: resolve('src/main/sheets/worker.ts') } }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preload scripts must be CommonJS.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { ...alias, '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()]
  }
})
