// electron/ipc.ts
import { ipcMain, dialog, shell, BrowserWindow, app, clipboard } from 'electron'
import { readdir } from 'node:fs/promises'
import { appendFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { linkStatus, createLink, pathContains, ensureInProfile, profilePathFor, isTransientExecPath } from './services/cli-link'
import type { DownloadFormat } from '../src/core/types'
import { fetchBinary as fetchGenericBinary } from '../src/core/fetch-html'
import { Library } from '../src/core/library'
import { History, eventFromSummary, type HistorySource } from '../src/core/download-history'
import { DownloadQueue } from '../src/core/download-queue'
import { downloadArticle } from '../src/core/download-article'
import { readArticleContent, type ReadableKind } from '../src/core/read-article'
import { crawlAccount } from '../src/core/mp-crawl'
import { MpAuthExpired } from '../src/core/mp-errors'
import type { CrawlRange, ArticleRef } from '../src/core/mp-types'
import { rebuildLibrary } from '../src/core/rebuild-library'
import { checkUpdate, type UpdateAsset, type UpdateInfo } from '../src/core/check-update'
import { resolveUpdateCheck } from '../src/core/update-gate'
import { detectChannel, upgradeCommand, pickAsset } from '../src/core/install-channel'
import { selectArticles, buildManifest, writeMaterialExport, buildAgentPrompt } from '../src/core/material-export'
import { syncToSite } from '../src/core/site-sync'
import { Subscriptions, accountsFromHistory, mergeAccounts, formatCheckLogLine, toDownloadItemLogs, type AccountDownloadLog, type CheckLogEntry } from '../src/core/subscriptions'
import { nextCheckAt } from '../src/core/subscription-schedule'
import { refId, sourceUrlKey } from '../src/core/subscription-refs'
import { collectPendingDownloads, toAccountDownloadLog, countDownloadOutcomes, mergeCheckDetailItems } from '../src/core/subscription-batch'
import { SubscriptionScheduler } from './services/subscription-scheduler'
import { UpdateScheduler } from './services/update-scheduler'
import { SettingsService } from './services/settings'
import { runSubscriptionCheck as svcRunSubscriptionCheck } from './services/subscription-check'
import type { RunCheckResult } from './services/subscription-check'
import { articleFetchers, createMpRuntime } from './services/mp-runtime'
import { makeWereadClient, runWereadLogin, wereadCredsStore, WereadLoginCancelled, wereadListFn, wereadCrawlListFn, wereadListUrl } from './services/weread-auth'
import { buildWereadQrFlowHttp } from './services/weread-net'
import { readWereadCredsFile, wereadCredsPath } from './services/weread-transport'
import { extractArticleKeys } from '../src/core/article-keys'
import { normalizeAccountId } from '../src/core/weread/book-id'
import { parseAccount } from '../src/core/parse-article'
import { HTML_TIMEOUT_MS } from '../src/core/fetch-html'
import * as cheerio from 'cheerio'
import { PRIVATE_API_FEATURE_ENABLED, RETIRED_PRIVATE_API_COMMANDS, retiredPrivateApiError, retiredPrivateApiResponse } from '../src/core/retired-private-api'

const randId = () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export function registerIpc(settings: SettingsService): void {
  const mpGateway = createMpRuntime(app.getPath('userData'))
  const { fetchHtml, fetchBinary } = articleFetchers(mpGateway)
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
  // wrapper 指向临时位置的产物会在打包/清理后悬空——临时位置一律不写（PRD-v0.10.3 R1）
  const transientLink = () => isTransientExecPath(process.execPath, app.isPackaged)

  ipcMain.handle('cliLink:status', async () => {
    if (!CLI_LINK_SUPPORTED) return { supported: false, status: 'unlinked', inPath: false, dir: cliLinkDir() }
    let status = await linkStatus(cliLinkPath(), process.execPath)
    if (status === 'legacy' && !transientLink()) {
      // ≤v0.5.1 建的是 symlink,mac 上经软链调用找不到 Helper app(download 必崩)——静默升级为 wrapper 脚本。
      // GUI 每次启动 CliLinkPrompt 都会查一次 status,老用户开一次 GUI 即自愈。
      // 临时位置不写（保持现状，等从正式安装启动再自愈）。
      await createLink(cliLinkDir(), cliLinkPath(), process.execPath, true)
      status = await linkStatus(cliLinkPath(), process.execPath)
    }
    return {
      supported: true,
      status,
      inPath: pathContains(cliLinkDir(), process.env.PATH),
      dir: cliLinkDir(),
      transient: transientLink(),
    }
  })
  ipcMain.handle('cliLink:create', async (_e, force: boolean) => {
    if (!CLI_LINK_SUPPORTED) return { status: 'unlinked' as const }
    if (transientLink()) {
      // 拒绝创建但回报现状，渲染层据 transient 标记给引导话术
      return { status: await linkStatus(cliLinkPath(), process.execPath), transient: true as const }
    }
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
    // M49：显式 URL 下载自动开启本次请求许可；用户已无 protection 设置入口，
    // 不能让旧的暂停状态把核心能力永久锁死。
    await mpGateway.resume()
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

  // —— M3.5 批量爬取 / M47 会话重置（v0.10.0 起经微信读书后端复活）——
  if (PRIVATE_API_FEATURE_ENABLED) {
  let crawlAbort: AbortController | null = null

  // —— 微信读书扫码登录（v0.10.0）：二维码与状态经事件推给渲染层，invoke 在流程结束时 settle ——
  let wereadLoginCancel = false
  let wereadLoginRunning = false
  ipcMain.handle('mp:login', (event) => runWereadLoginForRenderer(event, false))
  ipcMain.handle('mp:relogin', (event) => runWereadLoginForRenderer(event, true))

  async function runWereadLoginForRenderer(event: Electron.IpcMainInvokeEvent, fresh: boolean) {
    if (wereadLoginRunning) return { ok: false, error: '已有扫码流程在进行中', code: 'LOGIN_IN_PROGRESS' }
    wereadLoginRunning = true
    wereadLoginCancel = false
    try {
      if (fresh) await wereadCredsStore(app.getPath('userData')).clear()
      const send = (channel: string, payload: unknown) => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, payload)
      }
      const creds = await runWereadLogin(wereadCredsStore(app.getPath('userData')), {
        runAction: (task) => mpGateway.runAction('weread-auth', 'https://weread.qq.com/api/auth/getLoginUid', task),
        // 登录必须经 Chromium 网络栈：weread 按发起端指纹给会话分级，Node fetch 拿到降级会话
        // （业务列表恒 -2041）。见 weread-net.ts 头注。
        http: buildWereadQrFlowHttp(),
      }, {
        onQr: (qr) => send('weread:login:qr', { confirmUrl: qr.confirmUrl }),
        onState: (s) => send('weread:login:state', { state: s }),
        cancel: () => wereadLoginCancel,
      })
      emitSubsUpdated()
      return { ok: true, name: creds.name }
    } catch (e) {
      return {
        ok: false,
        error: (e as Error).message,
        code: e instanceof WereadLoginCancelled ? 'CANCELLED' : ((e as { code?: string }).code ?? 'LOGIN_FAILED'),
      }
    } finally { wereadLoginRunning = false }
  }
  ipcMain.on('weread:login:cancel', () => { wereadLoginCancel = true })

  // 设置页只读本地文件，不做微信读书探测；“登录是否仍有效”只有用户下一次明确操作才知道。
  ipcMain.handle('mp:sessionInfo', async () => {
    const value = await wereadCredsStore(app.getPath('userData')).read()
    return { loggedIn: !!value, loginAt: value?.updatedAt ?? null }
  })

  // 退出是纯本地安全动作：频控熔断时照样能退出，也不会改写熔断/审计状态。
  // 微信读书凭据不占 Chromium 分区，删除凭据文件即彻底退出。
  ipcMain.handle('mp:logout', async () => {
    crawlAbort?.abort()
    try { await wereadCredsStore(app.getPath('userData')).clear(); return { ok: true } }
    catch (e) { return { ok: false, error: (e as Error).message, code: 'LOGOUT_FAILED' } }
  })

  ipcMain.handle('mp:authStatus', async () => {
    const value = await wereadCredsStore(app.getPath('userData')).read()
    return value
      ? { status: 'present' as const, checkedAt: value.updatedAt, valid: null }
      : { status: 'missing' as const, valid: false }
  })

  ipcMain.handle('mp:protectionStatus', () => mpGateway.status())
  ipcMain.handle('mp:protectionPause', () => mpGateway.pause())
  ipcMain.handle('mp:protectionResume', () => mpGateway.resume())

  ipcMain.handle('mp:search', async (_e, articleUrl: string) => {
    // v0.10.0：语义从「按名字搜号」换成「从文章链接识别公众号」（微信读书无搜索接口）
    const url = String(articleUrl ?? '').trim()
    if (!/^https?:\/\/mp\.weixin\.qq\.com\//.test(url)) {
      return { ok: false, error: { code: 'CLI_ERROR', message: '需要 mp.weixin.qq.com 的文章链接' } }
    }
    try {
      const html = await mpGateway.fetchText('article-page', url, HTML_TIMEOUT_MS)
      const keys = extractArticleKeys(html)
      if (!keys.biz) return { ok: false, error: { code: 'NOT_FOUND', message: '页面里读不到公众号标识（可能是错误页或链接失效）' } }
      const fakeid = normalizeAccountId(keys.biz)
      const nickname = parseAccount(cheerio.load(html), html)
      let verified: { title: string; coverImg: string; author: string } | null = null
      const creds = await readWereadCredsFile(wereadCredsPath(app.getPath('userData')))
      if (creds) {
        try {
          const client = makeWereadClient((path, params) => mpGateway.requestWereadJson('weread-list', wereadListUrl(path, params)))
          const info = await client.bookInfo(fakeid)
          if (info.title) verified = { title: info.title, coverImg: info.coverImg, author: info.author }
        } catch { /* 校验失败不阻断识别 */ }
      }
      return { ok: true, list: [{ fakeid, nickname: verified?.title || nickname || fakeid, alias: '', signature: '' }] }
    } catch (e) {
      const code = e instanceof MpAuthExpired ? 'AUTH_REQUIRED' : ((e as { code?: string }).code ?? 'MP_API_ERROR')
      return { ok: false, error: { code, message: (e as Error).message } }
    }
  })

  ipcMain.on('mp:crawl:cancel', () => { crawlAbort?.abort() })
  ipcMain.handle('mp:crawl', async (event, { fakeid, nickname, range, formats, keywords }: { fakeid: string; nickname: string; range: CrawlRange; formats: DownloadFormat[]; keywords?: import('../src/core/mp-crawl').KeywordFilter }) => {
    if (RETIRED_PRIVATE_API_COMMANDS.has('crawl')) throw retiredPrivateApiError()
    const abort = new AbortController()
    crawlAbort = abort
    const creds = await readWereadCredsFile(wereadCredsPath(app.getPath('userData')))
    if (!creds) throw new Error('AUTH_REQUIRED')
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
      const listFn = await wereadCrawlListFn(app.getPath('userData'), (url) => mpGateway.requestWereadJson('weread-list', url))
      if (!listFn) throw new Error('AUTH_REQUIRED')
      const summary = await crawlAccount(fakeid, range, {
        listFn,
        keywords,
        downloadOne: (url, hint) => downloadArticle(url, formats, ddeps, hint),
        onListed: (refs) => send({ kind: 'listed', items: refs.map((r) => ({ title: r.title, url: r.url })) }),
        onItem: (ev) => send({ kind: 'item', ...ev }),
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

  // cover 以 reviewId 判重；订阅时不探测已封禁的列表端点，首次成功检查自然投递最新一篇。
  const establishWatermark = async (): Promise<number> => Math.floor(Date.now() / 1000)

  const downloadRefs = async (refs: ArticleRef[], formats: DownloadFormat[], source: HistorySource, onProgress?: (e: import('../src/core/types').ProgressEvent) => void) => {
    const { libraryRoot, downloadVideos } = await settings.get()
    const library = new Library(libraryRoot)
    const ddeps = { fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot, downloadVideos }
    const queue = new DownloadQueue((url, hint, report) => downloadArticle(url, formats, { ...ddeps, onProgress: report }, hint), onProgress)
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
      const library = new Library(s.libraryRoot)
      const downloadedUrls = new Set((await library.list()).map((article) => sourceUrlKey(article.sourceUrl)))
      const list = await wereadListFn(app.getPath('userData'), (url) => mpGateway.requestWereadJson('weread-list', url))
      const result = await svcRunSubscriptionCheck(trigger, {
        subs, settings: s, list,
        isRefDownloaded: async (ref) => downloadedUrls.has(sourceUrlKey(ref.url)),
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
    const merged = mergeAccounts(accountsFromHistory(events), await subs.list(), await subs.removedFakeids())
    const s = await settings.get()
    const lastRunAt = await subs.getLastRunAt()
    const nextCheckTime = s.subscriptionAutoCheck
      ? nextCheckAt(Date.now(), lastRunAt, { mode: s.subscriptionScheduleMode, checkTime: s.subscriptionCheckTime, intervalHours: s.subscriptionIntervalHours })
      : null
    return { accounts: merged, authExpired: subsAuthExpired, lastRunAt, checkLog: await subs.getCheckLog(), nextCheckAt: nextCheckTime }
  })
  ipcMain.handle('subscriptions:remove', async (_e, fakeid: string) => {
    await (await subsFor()).removeAccount(fakeid)
    emitSubsUpdated()
  })
  ipcMain.handle('subscriptions:addAccount', async (_e, { fakeid, nickname }: { fakeid: string; nickname: string }) => {
    await (await subsFor()).addAccount({ fakeid, nickname, subscribed: true, watermark: await establishWatermark() })
    emitSubsUpdated()
  })
  ipcMain.handle('subscriptions:setSubscribed', async (_e, { fakeid, nickname, subscribed }: { fakeid: string; nickname: string; subscribed: boolean }) => {
    const subs = await subsFor()
    const ex = (await subs.list()).find((a) => a.fakeid === fakeid)
    if (!ex) {
      await subs.addAccount({ fakeid, nickname, subscribed, watermark: subscribed ? await establishWatermark() : 0 })
    } else {
      if (subscribed && ex.watermark === 0) await subs.updateWatermark(fakeid, await establishWatermark())
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
    // M58:把本次结果回填进「本轮检查明细」——行内列表的 pending 状态就地变为结果态。
    // articleId 直接取下载结果自带的 id（下载器解析后的 canonical 主键），不按 url 反查文库
    // （检查给短链、库存长链，跨形态匹配不可靠）。只影响最近一条含该号的检查记录。
    const idByUrl = new Map(summary.items.filter((i) => i.id).map((i) => [i.url, i.id!] as const))
    const items = toDownloadItemLogs(summary.items, picked).map((item) => {
      const id = item.url != null ? idByUrl.get(item.url) : undefined
      return id ? { ...item, articleId: id } : item
    })
    await subs.mutateLatestCheckDetail(fakeid, (cur) => mergeCheckDetailItems(cur, items))
    emitProgress(total, 'done')
    emitSubsUpdated()
    return { downloaded: summary.succeeded, skipped: summary.skipped, failed: summary.failed, kept: total - done.size }
  })
  ipcMain.handle('subscriptions:downloadAllNew', async (event) => {
    const subs = await subsFor()
    const groups = collectPendingDownloads(await subs.list())
    const total = groups.reduce((sum, group) => sum + group.refs.length, 0)
    let downloaded = 0, skipped = 0, failed = 0, kept = 0, doneBefore = 0
    // M56:手动批量此前完全不落 checkLog —— 批量下载完在「检查记录」里查无此事。逐组收集交付明细,
    // 循环后落一条 kind='download' 纯交付日志;计数与明细同源(四状态),与自动下载共用同一套映射。
    const downloadDetail: AccountDownloadLog[] = []
    for (const group of groups) {
      const summary = await downloadRefs(group.refs, (await settings.get()).defaultFormats,
        { kind: 'account', nickname: group.nickname, fakeid: group.fakeid, range: { count: group.refs.length } },
        (e) => {
          if (!event.sender.isDestroyed()) event.sender.send('subscriptions:download:progress', {
            fakeid: group.fakeid, total: group.refs.length, done: e.completed, phase: e.phase,
            allTotal: total, allDone: doneBefore + e.completed, nickname: group.nickname,
          })
        })
      const completed = new Set(summary.items.filter((item) => item.ok || item.unavailable).map((item) => item.url))
      await subs.removeNewRefs(group.fakeid, group.refs.filter((ref) => completed.has(ref.url)).map(refId))
      downloadDetail.push(toAccountDownloadLog(group, summary))
      downloaded += summary.succeeded
      skipped += summary.skipped
      failed += summary.failed
      kept += group.refs.length - completed.size
      doneBefore += summary.items.length
    }
    // 无可下载(groups 为空)时不落 —— 空交付日志只有噪音。落盘失败由 logCheck 内部吞掉,不阻断返回。
    if (groups.length) {
      const outcomes = countDownloadOutcomes(downloadDetail)
      await logCheck(subs, {
        time: Date.now(), trigger: 'manual', kind: 'download', accounts: groups.length,
        newFound: 0, failed: 0, downloaded: outcomes.downloaded, existed: outcomes.existed, downloadDetail,
      })
    }
    emitSubsUpdated()
    return { accounts: groups.length, total, downloaded, skipped, failed, kept }
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

  new SubscriptionScheduler({
    settings,
    subsFor,
    runCheck: () => runSubscriptionCheck('auto'),
    canRun: async () => (await mpGateway.status()).mode === 'active',
  }).start()
  } else {
    // 保留 IPC 名称作为兼容壳：旧渲染调用得到稳定结果，不会落进“无 handler”异常，
    // 更不会读取 session、订阅数据或构造任何私有 API 请求。
    const unavailable = () => retiredPrivateApiResponse()
    for (const channel of [
      'mp:login', 'mp:relogin', 'mp:sessionInfo', 'mp:logout', 'mp:authStatus',
      'mp:protectionStatus', 'mp:protectionPause', 'mp:protectionResume', 'mp:search', 'mp:crawl',
      'subscriptions:list', 'subscriptions:addAccount', 'subscriptions:setSubscribed',
      'subscriptions:checkNow', 'subscriptions:downloadNew', 'subscriptions:dismissNew',
      'subscriptions:openLog',
    ]) ipcMain.handle(channel, unavailable)
    ipcMain.on('mp:crawl:cancel', () => {})
  }

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
      const { data } = await fetchGenericBinary(asset.url, Math.max(60_000, Math.ceil(asset.size / 200_000) * 1000))
      writeFileSync(dest, data)
      send(asset.size)
      void shell.openPath(dest)      // dmg 自动挂载 / exe 直接起安装程序
      return { ok: true, path: dest }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  new UpdateScheduler({ check: runUpdateCheck, windows: () => BrowserWindow.getAllWindows() }).start()
}
