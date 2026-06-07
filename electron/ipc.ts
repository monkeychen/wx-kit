// electron/ipc.ts
import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { readdir } from 'node:fs/promises'
import type { DownloadFormat } from '../src/core/types'
import { fetchHtml, fetchBinary } from '../src/core/fetch-html'
import { Library } from '../src/core/library'
import { DownloadQueue } from '../src/core/download-queue'
import { downloadArticle } from '../src/core/download-article'
import { readArticleContent, type ReadableKind } from '../src/core/read-article'
import { SettingsService } from './services/settings'

export function registerIpc(settings: SettingsService): void {
  const libraryFor = async () => new Library((await settings.get()).libraryRoot)

  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:save', (_e, patch) => settings.save(patch))

  ipcMain.handle('library:list', async () => (await libraryFor()).list())
  ipcMain.handle('library:search', async (_e, kw: string) => (await libraryFor()).search(kw))
  ipcMain.handle('library:remove', async (_e, id: string) => { await (await libraryFor()).remove(id) })
  ipcMain.handle('library:readContent', (_e, { dir, kind }: { dir: string; kind: ReadableKind }) =>
    readArticleContent(dir, kind))
  ipcMain.handle('library:coverName', async (_e, dir: string) => {
    try {
      const files = await readdir(dir)
      return files.find((f) => /^cover\.[a-z0-9]+$/i.test(f)) ?? null
    } catch {
      return null
    }
  })

  ipcMain.handle('dialog:chooseDir', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('shell:reveal', (_e, path: string) => { shell.showItemInFolder(path) })

  ipcMain.handle('download', async (event, { urls, formats }: { urls: string[]; formats: DownloadFormat[] }) => {
    const { libraryRoot } = await settings.get()
    const library = new Library(libraryRoot)
    const deps = {
      fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow,
      now: () => new Date().toISOString(), library, libraryRoot,
    }
    const queue = new DownloadQueue(
      (url) => downloadArticle(url, formats, deps),
      (ev) => { if (!event.sender.isDestroyed()) event.sender.send('download:progress', ev) },
    )
    return queue.run(urls)
  })
}
