// electron/ipc.ts
import { ipcMain, dialog, shell, BrowserWindow, app, clipboard } from 'electron'
import { readdir } from 'node:fs/promises'
import { appendFileSync, writeFileSync, existsSync } from 'node:fs'
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
import { login, getSession, clearSession } from './services/mp-auth'
import { makeMpFetch } from './services/mp-fetch'
import { searchAccount, listArticles } from '../src/core/mp-client'
import { crawlAccount } from '../src/core/mp-crawl'
import { MpAuthExpired } from '../src/core/mp-errors'
import type { CrawlRange, ArticleRef } from '../src/core/mp-types'
import { rebuildLibrary } from '../src/core/rebuild-library'
import { checkUpdate, type UpdateAsset, type UpdateInfo } from '../src/core/check-update'
import { resolveUpdateCheck } from '../src/core/update-gate'
import { detectChannel, upgradeCommand, pickAsset } from '../src/core/install-channel'
import { selectArticles, buildManifest, writeMaterialExport, buildAgentPrompt } from '../src/core/material-export'
import { syncToSite } from '../src/core/site-sync'
import { Subscriptions, accountsFromHistory, mergeAccounts, formatCheckLogLine, type CheckLogEntry } from '../src/core/subscriptions'
import { nextCheckAt } from '../src/core/subscription-schedule'
import { refId } from '../src/core/subscription-refs'
import { SubscriptionScheduler } from './services/subscription-scheduler'
import { UpdateScheduler } from './services/update-scheduler'
import { SettingsService } from './services/settings'
import { runSubscriptionCheck as svcRunSubscriptionCheck } from './services/subscription-check'
import type { RunCheckResult } from './services/subscription-check'

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

  // M32 站点同步:按 id 取 meta → 逐篇按站点规范落盘(纯本地,无网络)
  ipcMain.handle('library:syncToSite', async (_e, { items, postsDir }: { items: { id: string; slug: string }[]; postsDir?: string }) => {
    const s = await settings.get()
    const all = await new Library(s.libraryRoot).list()
    const byId = new Map(all.map((m) => [m.id, m]))
    const picked = items
      .filter((i) => byId.has(i.id))
      .map((i) => ({ meta: byId.get(i.id)!, slug: i.slug.trim() }))
    return syncToSite(picked, postsDir ?? s.siteSyncPostsDir)
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
    const { libraryRoot, downloadVideos } = await settings.get()
    const library = new Library(libraryRoot)
    const deps = {
      fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow,
      now: () => new Date().toISOString(), library, libraryRoot, downloadVideos,
    }
    const sendProgress = (ev: import('../src/core/types').ProgressEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send('download:progress', ev)
    }
    const queue = new DownloadQueue(
      (url) => downloadArticle(url, formats, {
        ...deps,
        // 视频可达上百 MB、单个要下一分多钟：不报进度的话界面一动不动，看着像卡死
        onVideoProgress: (e) => sendProgress({
          total: urls.length, completed: 0, currentUrl: url, phase: 'images',
          message: `正在下载视频 ${e.index}/${e.total}（${(e.video.filesize / 1048576).toFixed(1)}MB，${e.video.width}×${e.video.height}）`,
        }),
      }),
      sendProgress,
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

  // 设置页「公众号账号」区:只读本地 session,不发请求(不触发探测、不在频控期加重)。
  // 有效性探测归 mp:authStatus;这里只回答「有没有登录态 + 何时扫码」。
  ipcMain.handle('mp:sessionInfo', () => {
    const session = getSession()
    return { loggedIn: !!session, loginAt: session?.timestamp ?? null }
  })

  ipcMain.handle('mp:logout', () => { clearSession() })

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
    const { libraryRoot, downloadVideos } = await settings.get()
    const library = new Library(libraryRoot)
    const send = (ev: unknown) => { if (!event.sender.isDestroyed()) event.sender.send('mp:crawl:progress', ev) }
    const ddeps = {
      fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow,
      now: () => new Date().toISOString(), library, libraryRoot, downloadVideos,
      // 批量里选了视频格式时，逐篇的视频下载也要出声（同 URL 模式）
      onVideoProgress: (e: { index: number; total: number; video: { filesize: number; width: number; height: number } }) =>
        send({ kind: 'note', message: `正在下载视频 ${e.index}/${e.total}（${(e.video.filesize / 1048576).toFixed(1)}MB）` }),
    }
    try {
      const summary = await crawlAccount(fakeid, range, {
        mpFetch: makeMpFetch(session), token: session.token, keywords,
        downloadOne: (url, hint) => downloadArticle(url, formats, ddeps, hint),
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
  // M34:自动下载(检查里触发的)进度。定时检查没有 event.sender,只能广播;
  // 复用手动下载的同一 channel,渲染层不必区分来源。
  const broadcastDlProgress = (e: { fakeid: string; total: number; done: number; phase: string }) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('subscriptions:download:progress', e)
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
    const { libraryRoot, downloadVideos } = await settings.get()
    const library = new Library(libraryRoot)
    const ddeps = { fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot, downloadVideos }
    const queue = new DownloadQueue((url, hint) => downloadArticle(url, formats, ddeps, hint), onProgress)
    // 必须把列表给的文章主键(mid/idx)透传下去:订阅拿到的是**短链** `s/XXXX`,
    // 没有 hint 就只能退化成路径哈希 id,于是同一篇经「按公众号」抓时算另一篇 → 重复下载。
    // 这正是 M36 为 crawl 修过的那个 bug,当时漏了这个调用点(真实库里已积下 32 篇哈希 id)。
    const summary = await queue.run(refs.map((r) => ({ url: r.url, appmsgid: r.appmsgid, itemidx: r.itemidx })))
    await recordHistory(source, formats, summary)
    return summary
  }

  const logPath = join(app.getPath('userData'), 'subscriptions-check.log')
  const logCheck = async (subs: Subscriptions, entry: CheckLogEntry) => {
    try { await subs.appendCheckLog(entry); appendFileSync(logPath, formatCheckLogLine(entry) + '\n') }
    catch { /* 留痕失败不阻断检查主流程 */ }
  }

  // 共享 in-flight:自动检查与手动「检查更新」/行内单号检查重叠时并入同一次运行(防重入的第二道闸,第一道在 scheduler tick)
  let checkInFlight: Promise<RunCheckResult> | null = null
  const runSubscriptionCheck = (trigger: 'auto' | 'manual', fakeids?: string[]): Promise<RunCheckResult> => {
    if (checkInFlight) return checkInFlight
    checkInFlight = (async () => {
      const subs = await subsFor()
      const s = await settings.get()
      const session = getSession()
      const result = await svcRunSubscriptionCheck(trigger, {
        subs, settings: s, session: session ? { token: session.token } : null,
        mpFetch: session ? makeMpFetch(session) : null,
        downloadRefs, log: (entry) => logCheck(subs, entry), onEmit: emitSubsUpdated,
        onDownloadProgress: broadcastDlProgress,
        ...(fakeids ? { fakeids } : {}),
      })
      if (result.note !== 'no-accounts') subsAuthExpired = result.authExpired
      return result
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
  ipcMain.handle('subscriptions:checkNow', (_e, fakeids?: string[]) => runSubscriptionCheck('manual', fakeids))
  /** M40:ids 省略 = 全部待处理(老调用方不变);给了就只动这几篇,其余留在列表里 */
  const pickRefs = (acc: { newRefs: ArticleRef[] }, ids?: string[]) =>
    ids?.length ? acc.newRefs.filter((r) => ids.includes(refId(r))) : acc.newRefs

  ipcMain.handle('subscriptions:downloadNew', async (event, fakeid: string, ids?: string[]) => {
    const subs = await subsFor()
    const acc = (await subs.list()).find((a) => a.fakeid === fakeid)
    if (!acc || !acc.newRefs.length) return
    const picked = pickRefs(acc, ids)
    if (!picked.length) return
    const total = picked.length
    const emitProgress = (done: number, phase: string) => {
      if (!event.sender.isDestroyed()) event.sender.send('subscriptions:download:progress', { fakeid, total, done, phase })
    }
    emitProgress(0, 'start')
    const summary = await downloadRefs(picked, (await settings.get()).defaultFormats,
      { kind: 'account', nickname: acc.nickname, fakeid, range: { count: total } },
      (e) => emitProgress(e.completed, e.phase))
    // 只移除「处理完了」的:成功、已在库、以及读者本就打不开的(重试无用)。
    // **真故障(网络/频控)留在待处理里等重试** —— 此前无脑清空,下载失败的那篇就此消失,
    // 用户点了下载、失败了、列表里也没了,连重试的入口都没有。
    const done = new Set(summary.items.filter((i) => i.ok || i.unavailable).map((i) => i.url))
    await subs.removeNewRefs(fakeid, picked.filter((r) => done.has(r.url)).map(refId))
    emitProgress(total, 'done')
    emitSubsUpdated()
    return { downloaded: summary.succeeded, skipped: summary.skipped, failed: summary.failed, kept: total - done.size }
  })
  ipcMain.handle('subscriptions:dismissNew', async (_e, fakeid: string, ids?: string[]) => {
    const subs = await subsFor()
    const acc = (await subs.list()).find((a) => a.fakeid === fakeid)
    if (!acc) return
    // 水位在检查时就已推过全部新文章(subscription-check.ts:83),这里推一次是 no-op,
    // 留着只为「即使将来检查顺序变了也不会倒退」;**别以为忽略是靠推水位实现的**——
    // 忽略就是把这几篇从待处理里拿掉,它们不会被重新发现是水位早就过了的缘故。
    await subs.updateWatermark(fakeid, acc.newRefs.reduce((mx, r) => Math.max(mx, r.createTime), acc.watermark))
    await subs.removeNewRefs(fakeid, pickRefs(acc, ids).map(refId))
    emitSubsUpdated()
  })
  ipcMain.handle('subscriptions:openLog', () => {
    try { writeFileSync(logPath, '', { flag: 'a' }) } catch { /* 确保文件存在即可 */ }
    shell.showItemInFolder(logPath)
  })

  // —— M37 更新检查(只检查 + 按渠道引导,不做静默自更新;理由见 PRD-v0.8.2 R3)——
  // M39:门控决策移到 core 的 update-gate,IPC 与定时 tick 共用这一份实现
  const runUpdateCheck = async (silent: boolean): Promise<UpdateInfo | null> => {
    const s = await settings.get()
    return resolveUpdateCheck({
      silent, enabled: s.updateCheckEnabled, lastCheckedAt: s.lastUpdateCheckAt,
      cached: s.lastKnownRelease, currentVersion: app.getVersion(), now: Date.now(),
      check: checkUpdate,
      save: (patch) => settings.save(patch).then(() => undefined),
    })
  }
  ipcMain.handle('update:check', (_e, opts?: { silent?: boolean }) => runUpdateCheck(opts?.silent === true))

  ipcMain.handle('update:channel', () => {
    const channel = detectChannel({ platform: process.platform, existsSync })
    return { channel, command: upgradeCommand(channel), platform: process.platform, arch: process.arch }
  })

  ipcMain.handle('update:downloadAsset', async (event, assets: UpdateAsset[]) => {
    const asset = pickAsset(assets, process.platform, process.arch)
    if (!asset) return { ok: false, error: 'no-matching-asset' }
    const dest = join(app.getPath('downloads'), asset.name)
    const send = (done: number) => {
      // 单独的事件通道:混进 download:progress 会让「下载」页误以为在下文章
      if (!event.sender.isDestroyed()) event.sender.send('update:progress', { name: asset.name, done, total: asset.size })
    }
    try {
      send(0)
      // 安装包与视频同量级(140MB),沿用按体积算的超时,别用图片档
      const { data } = await fetchBinary(asset.url, Math.max(60_000, Math.ceil(asset.size / 200_000) * 1000))
      writeFileSync(dest, data)
      send(asset.size)
      void shell.openPath(dest)      // dmg 自动挂载 / exe 直接起安装程序
      return { ok: true, path: dest }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  new SubscriptionScheduler({ settings, subsFor, runCheck: () => runSubscriptionCheck('auto') }).start()
  new UpdateScheduler({ check: runUpdateCheck, windows: () => BrowserWindow.getAllWindows() }).start()
}
