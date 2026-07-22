// electron/ipc.ts
import { ipcMain, dialog, shell, BrowserWindow, app, clipboard } from 'electron'
import { readdir } from 'node:fs/promises'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { linkStatus, createLink, pathContains, ensureInProfile, profilePathFor } from './services/cli-link'
import type { DownloadFormat } from '../src/core/types'
import { fetchHtml, fetchBinary } from '../src/core/fetch-html'
import { Library } from '../src/core/library'
import { History, eventFromSummary, type HistorySource } from '../src/core/download-history'
import { DownloadQueue } from '../src/core/download-queue'
import { downloadArticle } from '../src/core/download-article'
import { readArticleContent, type ReadableKind } from '../src/core/read-article'
import { login, getSession } from './services/mp-auth'
import { makeMpFetch } from './services/mp-fetch'
import { searchAccount, listArticles } from '../src/core/mp-client'
import { crawlAccount } from '../src/core/mp-crawl'
import { MpAuthExpired } from '../src/core/mp-errors'
import type { CrawlRange, ArticleRef } from '../src/core/mp-types'
import { rebuildLibrary } from '../src/core/rebuild-library'
import { selectArticles, buildManifest, writeMaterialExport, buildAgentPrompt } from '../src/core/material-export'
import { Subscriptions, accountsFromHistory, mergeAccounts, formatCheckLogLine, type CheckLogEntry } from '../src/core/subscriptions'
import { nextCheckAt } from '../src/core/subscription-schedule'
import { SubscriptionScheduler } from './services/subscription-scheduler'
import { SettingsService } from './services/settings'
import { runSubscriptionCheck as svcRunSubscriptionCheck } from './services/subscription-check'

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
  ipcMain.handle('library:removeMany', async (_e, ids: string[]) => {
    const lib = await libraryFor(); const hist = await historyFor()
    for (const id of ids) { await lib.remove(id); await hist.markDeleted(id) }
  })
  ipcMain.handle('library:rebuild', async () => rebuildLibrary((await settings.get()).libraryRoot))
  ipcMain.handle('library:exportMaterial', async (_e, ids: string[]) => {
    const root = (await settings.get()).libraryRoot
    const all = await new Library(root).list()
    const manifest = buildManifest(selectArticles(all, { ids }))
    const path = await writeMaterialExport(root, manifest)
    // prompt 一并返回:渲染层直接拿去复制,不必重复拼串(拼串逻辑在 core 里有单测)
    return { path, count: manifest.count, prompt: buildAgentPrompt(path, manifest.count) }
  })

  ipcMain.handle('history:list', async (_e, { offset, limit }: { offset: number; limit: number }) =>
    (await historyFor()).list(offset, limit))
  ipcMain.handle('history:remove', async (_e, id: string) => { await (await historyFor()).removeEvent(id) })
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
  // 只放行 https,避免渲染层传入 file:// 等协议被系统当命令执行
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
  })

  // 版本号取自 package.json,不硬编码——发版漏改就会撒谎
  ipcMain.handle('app:version', () => app.getVersion())

  // 走主进程 clipboard:渲染层是 file:// 非安全上下文,navigator.clipboard 行为不可靠
  ipcMain.handle('clipboard:write', (_e, text: string) => { clipboard.writeText(text) })

  // —— M18 命令行快捷命令(M20 起为 wrapper 脚本) ——
  const CLI_LINK_SUPPORTED = process.platform === 'darwin' || process.platform === 'linux'
  const cliLinkDir = () => join(homedir(), 'bin')
  const cliLinkPath = () => join(cliLinkDir(), 'wx-kit')

  ipcMain.handle('cliLink:status', async () => {
    if (!CLI_LINK_SUPPORTED) return { supported: false, status: 'unlinked', inPath: false, dir: cliLinkDir() }
    let status = await linkStatus(cliLinkPath(), process.execPath)
    if (status === 'legacy') {
      // ≤v0.5.1 建的是 symlink,mac 上经软链调用找不到 Helper app(download 必崩)——静默升级为 wrapper 脚本。
      // GUI 每次启动 CliLinkPrompt 都会查一次 status,老用户开一次 GUI 即自愈。
      await createLink(cliLinkDir(), cliLinkPath(), process.execPath, true)
      status = await linkStatus(cliLinkPath(), process.execPath)
    }
    return {
      supported: true,
      status,
      inPath: pathContains(cliLinkDir(), process.env.PATH),
      dir: cliLinkDir(),
    }
  })
  ipcMain.handle('cliLink:create', async (_e, force: boolean) => {
    if (!CLI_LINK_SUPPORTED) return { status: 'unlinked' as const }
    await createLink(cliLinkDir(), cliLinkPath(), process.execPath, force)
    return { status: await linkStatus(cliLinkPath(), process.execPath) }
  })
  ipcMain.handle('cliLink:addToPath', async () => {
    const profilePath = profilePathFor(process.env.SHELL, homedir())
    const result = await ensureInProfile(profilePath)
    return { profilePath, result }
  })

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

  let crawlAbort: AbortController | null = null
  ipcMain.on('mp:crawl:cancel', () => { crawlAbort?.abort() })
  ipcMain.handle('mp:crawl', async (event, { fakeid, nickname, range, formats, keywords }: { fakeid: string; nickname: string; range: CrawlRange; formats: DownloadFormat[]; keywords?: import('../src/core/mp-crawl').KeywordFilter }) => {
    const abort = new AbortController()
    crawlAbort = abort
    const session = getSession()
    if (!session) throw new Error('AUTH_REQUIRED')
    const { libraryRoot } = await settings.get()
    const library = new Library(libraryRoot)
    const ddeps = {
      fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow,
      now: () => new Date().toISOString(), library, libraryRoot,
    }
    const send = (ev: unknown) => { if (!event.sender.isDestroyed()) event.sender.send('mp:crawl:progress', ev) }
    try {
      const summary = await crawlAccount(fakeid, range, {
        mpFetch: makeMpFetch(session), token: session.token, keywords,
        downloadOne: (url) => downloadArticle(url, formats, ddeps),
        onListed: (refs) => send({ kind: 'listed', items: refs.map((r) => ({ title: r.title, url: r.url })) }),
        onItem: (ev) => send({ kind: 'item', ...ev }),
        onBackoff: (ev) => send({ kind: 'backoff', ...ev }),
        shouldContinue: () => !abort.signal.aborted,
        signal: abort.signal,
      })
      send({ kind: 'done', summary })
      await recordHistory({ kind: 'account', nickname, fakeid, range }, formats, summary)
      return summary
    } finally {
      if (crawlAbort === abort) crawlAbort = null   // 任务结束后清引用，避免晚到的取消误伤下一次
    }
  })

  // —— M11 公众号订阅 ——
  const subsFor = async () => new Subscriptions((await settings.get()).libraryRoot)
  const emitSubsUpdated = () => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('subscriptions:updated')
  }
  let subsAuthExpired = false

  // 订阅/新订阅一刻确定水位：能取到最新一篇就用其 createTime，否则用「现在」（秒），避免存量被当新文章
  const establishWatermark = async (fakeid: string): Promise<number> => {
    const session = getSession()
    if (!session) return Math.floor(Date.now() / 1000)
    try {
      const refs = await listArticles(makeMpFetch(session), session.token, fakeid, { count: 1 })
      return refs[0]?.createTime ?? Math.floor(Date.now() / 1000)
    } catch { return Math.floor(Date.now() / 1000) }
  }

  const downloadRefs = async (refs: ArticleRef[], formats: DownloadFormat[], source: HistorySource, onProgress?: (e: import('../src/core/types').ProgressEvent) => void) => {
    const { libraryRoot } = await settings.get()
    const library = new Library(libraryRoot)
    const ddeps = { fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot }
    const queue = new DownloadQueue((url) => downloadArticle(url, formats, ddeps), onProgress)
    const summary = await queue.run(refs.map((r) => r.url))
    await recordHistory(source, formats, summary)
  }

  const logPath = join(app.getPath('userData'), 'subscriptions-check.log')
  const logCheck = async (subs: Subscriptions, entry: CheckLogEntry) => {
    try { await subs.appendCheckLog(entry); appendFileSync(logPath, formatCheckLogLine(entry) + '\n') }
    catch { /* 留痕失败不阻断检查主流程 */ }
  }

  // 共享 in-flight:自动检查与手动「检查更新」/行内单号检查重叠时并入同一次运行(防重入的第二道闸,第一道在 scheduler tick)
  let checkInFlight: Promise<void> | null = null
  const runSubscriptionCheck = (trigger: 'auto' | 'manual', fakeids?: string[]): Promise<void> => {
    if (checkInFlight) return checkInFlight
    checkInFlight = (async () => {
      const subs = await subsFor()
      const s = await settings.get()
      const session = getSession()
      const result = await svcRunSubscriptionCheck(trigger, {
        subs, settings: s, session: session ? { token: session.token } : null,
        mpFetch: session ? makeMpFetch(session) : null,
        downloadRefs, log: (entry) => logCheck(subs, entry), onEmit: emitSubsUpdated,
        ...(fakeids ? { fakeids } : {}),
      })
      if (result.note !== 'no-accounts') subsAuthExpired = result.authExpired
    })().finally(() => { checkInFlight = null })
    return checkInFlight
  }

  ipcMain.handle('subscriptions:list', async () => {
    const { events } = await (await historyFor()).list(0, 1_000_000)
    const subs = await subsFor()
    const merged = mergeAccounts(accountsFromHistory(events), await subs.list())
    const s = await settings.get()
    const lastRunAt = await subs.getLastRunAt()
    const nextCheckTime = s.subscriptionAutoCheck
      ? nextCheckAt(Date.now(), lastRunAt, { mode: s.subscriptionScheduleMode, checkTime: s.subscriptionCheckTime, intervalHours: s.subscriptionIntervalHours })
      : null
    return { accounts: merged, authExpired: subsAuthExpired, lastRunAt, checkLog: await subs.getCheckLog(), nextCheckAt: nextCheckTime }
  })
  ipcMain.handle('subscriptions:addAccount', async (_e, { fakeid, nickname }: { fakeid: string; nickname: string }) => {
    await (await subsFor()).addAccount({ fakeid, nickname, subscribed: true, watermark: await establishWatermark(fakeid) })
    emitSubsUpdated()
  })
  ipcMain.handle('subscriptions:setSubscribed', async (_e, { fakeid, nickname, subscribed }: { fakeid: string; nickname: string; subscribed: boolean }) => {
    const subs = await subsFor()
    const ex = (await subs.list()).find((a) => a.fakeid === fakeid)
    if (!ex) {
      await subs.addAccount({ fakeid, nickname, subscribed, watermark: subscribed ? await establishWatermark(fakeid) : 0 })
    } else {
      if (subscribed && ex.watermark === 0) await subs.updateWatermark(fakeid, await establishWatermark(fakeid))
      await subs.setSubscribed(fakeid, subscribed)
    }
    emitSubsUpdated()
  })
  ipcMain.handle('subscriptions:checkNow', async (_e, fakeids?: string[]) => { await runSubscriptionCheck('manual', fakeids) })
  ipcMain.handle('subscriptions:downloadNew', async (event, fakeid: string) => {
    const subs = await subsFor()
    const acc = (await subs.list()).find((a) => a.fakeid === fakeid)
    if (!acc || !acc.newRefs.length) return
    const total = acc.newRefs.length
    const emitProgress = (done: number, phase: string) => {
      if (!event.sender.isDestroyed()) event.sender.send('subscriptions:download:progress', { fakeid, total, done, phase })
    }
    emitProgress(0, 'start')
    await downloadRefs(acc.newRefs, (await settings.get()).defaultFormats,
      { kind: 'account', nickname: acc.nickname, fakeid, range: { count: total } },
      (e) => emitProgress(e.completed, e.phase))
    await subs.clearNewRefs(fakeid)
    emitProgress(total, 'done')
    emitSubsUpdated()
  })
  ipcMain.handle('subscriptions:dismissNew', async (_e, fakeid: string) => {
    const subs = await subsFor()
    const acc = (await subs.list()).find((a) => a.fakeid === fakeid)
    if (acc) await subs.updateWatermark(fakeid, acc.newRefs.reduce((mx, r) => Math.max(mx, r.createTime), acc.watermark))
    await subs.clearNewRefs(fakeid)
    emitSubsUpdated()
  })
  ipcMain.handle('subscriptions:openLog', () => {
    try { writeFileSync(logPath, '', { flag: 'a' }) } catch { /* 确保文件存在即可 */ }
    shell.showItemInFolder(logPath)
  })

  new SubscriptionScheduler({ settings, subsFor, runCheck: () => runSubscriptionCheck('auto') }).start()
}
