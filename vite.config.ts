import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    react(),
    electron([
      { entry: 'electron/main.ts' },
      { entry: 'electron/preload.ts', onstart(o) { o.reload() } },
    ]),
    renderer(),
  ],
  build: { outDir: 'dist' },
})
