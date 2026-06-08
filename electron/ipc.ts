// electron/ipc.ts
import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { readdir } from 'node:fs/promises'
import type { DownloadFormat } from '../src/core/types'
import { fetchHtml, fetchBinary } from '../src/core/fetch-html'
import { Library } from '../src/core/library'
import { History, eventFromSummary, type HistorySource } from '../src/core/download-history'
import { DownloadQueue } from '../src/core/download-queue'
import { downloadArticle } from '../src/core/download-article'
import { readArticleContent, type ReadableKind } from '../src/core/read-article'
import { login, getSession } from './services/mp-auth'
import { makeMpFetch } from './services/mp-fetch'
import { searchAccount } from '../src/core/mp-client'
import { crawlAccount } from '../src/core/mp-crawl'
import { MpAuthExpired } from '../src/core/mp-errors'
import type { CrawlRange } from '../src/core/mp-types'
import { SettingsService } from './services/settings'

const randId = () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export function registerIpc(settings: SettingsService): void {
  const libraryFor = async () => new Library((await settings.get()).libraryRoot)
  const historyFor = async () => {
    const s = await settings.get()
    return new History(s.libraryRoot, s.historyRetentionDays)
  }
  const recordHistory = async (source: HistorySource, formats: DownloadFormat[], summary: import('../src/core/types').DownloadSummary) => {
    try { await (await historyFor()).append(eventFromSummary(randId(), Date.now(), source, formats, summary)) }
    catch { /* 历史是辅助记录，写失败不应阻断下载主流程 */ }
  }

  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:save', (_e, patch) => settings.save(patch))

  ipcMain.handle('library:list', async () => (await libraryFor()).list())
  ipcMain.handle('library:search', async (_e, kw: string) => (await libraryFor()).search(kw))
  ipcMain.handle('library:remove', async (_e, id: string) => {
    await (await libraryFor()).remove(id)
    await (await historyFor()).markDeleted(id)   // 联动：历史里引用该文章的项标记为已删除
  })

  ipcMain.handle('history:list', async (_e, { offset, limit }: { offset: number; limit: number }) =>
    (await historyFor()).list(offset, limit))
  ipcMain.handle('history:clear', async () => { await (await historyFor()).clear() })
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
    const summary = await queue.run(urls)
    await recordHistory({ kind: 'url', count: urls.length }, formats, summary)
    return summary
  })

  // —— M3.5 批量爬取 ——
  ipcMain.handle('mp:login', async () => {
    try { await login(); return { ok: true } }
    catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('mp:authStatus', async () => {
    const session = getSession()
    if (!session) return { valid: false }
    try { await searchAccount(makeMpFetch(session), session.token, '腾讯'); return { valid: true } }
    catch (e) { if (e instanceof MpAuthExpired) return { valid: false }; throw e }
  })

  ipcMain.handle('mp:search', async (_e, name: string) => {
    const session = getSession()
    if (!session) return { ok: false, error: { code: 'AUTH_REQUIRED', message: '请先登录公众号后台' } }
    try { return { ok: true, list: await searchAccount(makeMpFetch(session), session.token, name) } }
    catch (e) {
      const code = e instanceof MpAuthExpired ? 'AUTH_REQUIRED' : 'MP_API_ERROR'
      return { ok: false, error: { code, message: (e as Error).message } }
    }
  })

  let cancelRequested = false
  ipcMain.on('mp:crawl:cancel', () => { cancelRequested = true })
  ipcMain.handle('mp:crawl', async (event, { fakeid, nickname, range, formats }: { fakeid: string; nickname: string; range: CrawlRange; formats: DownloadFormat[] }) => {
    cancelRequested = false
    const session = getSession()
    if (!session) throw new Error('AUTH_REQUIRED')
    const { libraryRoot } = await settings.get()
    const library = new Library(libraryRoot)
    const ddeps = {
      fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow,
      now: () => new Date().toISOString(), library, libraryRoot,
    }
    const send = (ev: unknown) => { if (!event.sender.isDestroyed()) event.sender.send('mp:crawl:progress', ev) }
    const summary = await crawlAccount(fakeid, range, {
      mpFetch: makeMpFetch(session), token: session.token,
      downloadOne: (url) => downloadArticle(url, formats, ddeps),
      onListed: (refs) => send({ kind: 'listed', items: refs.map((r) => ({ title: r.title, url: r.url })) }),
      onItem: (ev) => send({ kind: 'item', ...ev }),
      shouldContinue: () => !cancelRequested,
    })
    send({ kind: 'done', summary })
    await recordHistory({ kind: 'account', nickname, fakeid, range }, formats, summary)
    return summary
  })
}
