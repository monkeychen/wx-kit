import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // cheerio pulls in undici, whose sqlite-cache-store statically
              // requires node:sqlite — a builtin Electron's Node runtime lacks.
              // We only use cheerio.load (static parsing), never fromURL/fetch,
              // so undici is never needed at runtime; keep it external & lazy.
              external: ['undici'],
            },
          },
        },
      },
      { entry: 'electron/preload.ts', onstart(o) { o.reload() } },
    ]),
    renderer(),
  ],
  build: { outDir: 'dist' },
})
