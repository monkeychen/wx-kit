// src/cli/index.ts
import { Command } from 'commander'
import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import QRCode from 'qrcode'
import * as cheerio from 'cheerio'
import type { DownloadFormat, DownloadSummary } from '../core/types'
import { ALL_FORMATS } from '../core/types'
import { Library } from '../core/library'
import { DownloadQueue } from '../core/download-queue'
import { downloadArticle } from '../core/download-article'
import { extractArticleKeys } from '../core/article-keys'
import { parseAccount } from '../core/parse-article'
import { normalizeAccountId } from '../core/weread/book-id'
import { MpAuthExpired } from '../core/mp-errors'
import { HTML_TIMEOUT_MS } from '../core/fetch-html'
import { RETIRED_PRIVATE_API_COMMANDS, retiredPrivateApiResponse } from '../core/retired-private-api'
import { rebuildLibrary } from '../core/rebuild-library'
import { checkUpdate } from '../core/check-update'
import { detectChannel, upgradeCommand } from '../core/install-channel'
import { selectArticles, buildManifest } from '../core/material-export'
import { sortArticles } from '../core/library-sort'
import { syncToSite } from '../core/site-sync'
import { SettingsService } from '../../electron/services/settings'
import { parseSettingAssignment } from '../../electron/services/settings-cli'
import { History, eventFromSummary, type HistorySource } from '../core/download-history'
import { Subscriptions, accountsFromHistory, mergeAccounts, formatCheckLogLine, normalizeAccountKey } from '../core/subscriptions'
import { nextCheckAt } from '../core/subscription-schedule'
import { resolveDigestDate } from '../core/digest-date'
import { subscriptionDigest, type DigestFailure } from '../core/subscription-digest'
import { refreshDigest } from '../core/refresh-digest'
import { sourceUrlKey } from '../core/subscription-refs'
import { runSubscriptionCheck } from '../../electron/services/subscription-check'
import { articleFetchers, createMpRuntime } from '../../electron/services/mp-runtime'
import type { MpRequestGateway } from '../../electron/services/mp-request-gateway'
import {
  ensureFreshWereadCreds, makeWereadClient, runWereadLogin, WereadLoginCancelled,
  wereadCredsStore, wereadListFn, wereadListUrl
} from '../../electron/services/weread-auth'
import { buildWereadQrFlowHttp } from '../../electron/services/weread-net'

function defaultLibraryRoot(): string {
  return join(homedir(), 'Documents', 'wx-kit')
}

function parseFormats(csv: string): DownloadFormat[] {
  const set = new Set(csv.split(',').map(s => s.trim()).filter(Boolean))
  const out = ALL_FORMATS.filter(f => set.has(f))
  if (!out.length) throw new Error(`no valid formats in "${csv}"; valid: ${ALL_FORMATS.join(',')}`)
  return out
}

function out(summary: DownloadSummary): void {
  process.stdout.write(JSON.stringify(summary) + '\n')
}

function outJson(obj: unknown): void { process.stdout.write(JSON.stringify(obj) + '\n') }

/** 解析 CLI 参数并执行；返回退出码 */
export async function runCli(argv: string[], opts: { version?: string; userDataDir?: string } = {}): Promise<number> {
  const program = new Command()
  program.name('wx-kit')
    .description('微信百宝箱 CLI — 与 GUI 同一二进制:无参启动图形界面,带子命令进入命令行模式。\n'
      + '输出契约:stdout 纯 JSON(数据),stderr 进度/日志;退出码 0=成功 1=业务失败 2=用法错误。')
    .exitOverride()
  program.version(opts.version ?? '0.0.0-dev', '-v, --version', '输出版本号')
  program.configureOutput({
    writeOut: (s) => process.stdout.write(s),   // help/version 是主动查询,走 stdout
    writeErr: (s) => process.stderr.write(s),   // 报错 usage 走 stderr
  })
  program.addHelpText('after', `
常用示例:
  wx-kit download --url "https://mp.weixin.qq.com/s/XXX" --formats md,pdf
  wx-kit login                                      # 扫码登录微信读书(订阅/按公众号下载的前置)
  wx-kit search --url "https://mp.weixin.qq.com/s/XXX"   # 从文章链接识别公众号
  wx-kit subscription check-now                     # 检查订阅更新
  wx-kit library list
  wx-kit settings get libraryRoot
  wx-kit site sync --ids <id> --slug my-post        # 同步到个人站点(需先配 siteSyncPostsDir)

文章库默认在 ~/Documents/wx-kit(可用 settings set libraryRoot <dir> 修改)。
列表后端是微信读书;按名字搜索公众号已不可用,改用 search --url 从任意文章链接识别。
各命令详情:wx-kit help <命令>

仓库:https://github.com/monkeychen/wx-kit(可读 README.md / issues / releases 深入了解)`)

  // opts.userDataDir 由 main.ts 注入真实 app.getPath('userData')，与 GUI 同源；
  // '.wx-kit' 仅为 opts 缺省时的安全兜底，实际运行不会用到
  const userDataDir = opts.userDataDir ?? join(homedir(), '.wx-kit')
  const settingsFor = () =>
    new SettingsService(userDataDir, defaultLibraryRoot())
  const resolveRoot = async (optOut?: string): Promise<string> =>
    optOut ?? (await settingsFor().get()).libraryRoot
  let gateway: MpRequestGateway | null = null
  const mpGateway = () => (gateway ??= createMpRuntime(userDataDir))
  const mpArticleFetchers = () => articleFetchers(mpGateway())

  const randId = () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

  let exitCode = 0

  program
    .command('download')
    .description('下载一个或多个微信文章 URL')
    .option('-u, --url <url...>', '文章 URL（可多次）', [])
    .option('-f, --urls-file <file>', '每行一个 URL 的文件')
    .option('--formats <csv>', '逗号分隔：cover,md,html,pdf,meta', 'md,html,meta')
    .option('--no-video', '不下载文中内嵌视频（默认会下；单个视频可达上百 MB）')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (opts) => {
      const urls: string[] = [...(opts.url ?? [])].map((s: string) => s.trim()).filter(Boolean)
      if (opts.urlsFile) {
        urls.push(...readFileSync(opts.urlsFile, 'utf-8').split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean))
      }
      if (!urls.length) throw new Error('no urls; use --url or --urls-file')
      const formats = parseFormats(opts.formats)
      const root = await resolveRoot(opts.out)
      const library = new Library(root)
      // M49：用户明确点击/执行一次 URL 下载，就是一次新的有效动作。
      // 自动恢复旧治理状态，避免已隐藏的 protection UI 让核心下载永久卡住。
      await mpGateway().resume()
      // commander 的 --no-video 把 opts.video 置 false；缺省为 true
      const deps = { ...mpArticleFetchers(), BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot: root, downloadVideos: opts.video !== false }

      const queue = new DownloadQueue(
        (url) => downloadArticle(url, formats, {
          ...deps,
          // 视频动辄上百 MB、单个一分多钟：stderr 上要说一声，否则看着像挂了
          onVideoProgress: (e) => process.stderr.write(
            `  ↓ 视频 ${e.index}/${e.total}：${(e.video.filesize / 1048576).toFixed(1)}MB ${e.video.width}×${e.video.height}\n`),
        }),
        (e) => process.stderr.write(`[${e.completed}/${e.total}] ${e.phase} ${e.currentUrl}${e.message ? ' ' + e.message : ''}\n`),
      )
      const summary = await queue.run(urls)
      out(summary)
      exitCode = summary.ok ? 0 : 1
    })

  program
    .command('search')
    .description('从文章链接识别公众号（返回订阅/批量下载用的账号标识；按名字搜索已不可用）')
    .requiredOption('--url <url>', '该公众号任意一篇文章的链接')
    .action(async (opts) => {
      const url = String(opts.url ?? '').trim()
      if (!/^https?:\/\/mp\.weixin\.qq\.com\//.test(url)) {
        outJson({ ok: false, error: { code: 'CLI_ERROR', message: '需要 mp.weixin.qq.com 的文章链接（--url）' } }); exitCode = 2; return
      }
      try {
        // 抓文章页本身走 article-page（公开页，不需要登录态）——与 download 同一条保护闸
        const html = await mpGateway().fetchText('article-page', url, HTML_TIMEOUT_MS)
        const keys = extractArticleKeys(html)
        if (!keys.biz) {
          outJson({ ok: false, error: { code: 'NOT_FOUND', message: '页面里读不到公众号标识（可能是错误页或链接失效）' } }); exitCode = 1; return
        }
        const fakeid = normalizeAccountId(keys.biz)
        const nickname = parseAccount(cheerio.load(html), html)
        // 已登录时用微信读书的 /book/info 校验收录状态并拿权威名称；未登录或未收录时退回页面名
        let verified: { title: string; coverImg: string; author: string } | null = null
        const creds = await wereadCredsStore(userDataDir).read()
        if (creds) {
          try {
            const client = makeWereadClient((path, params) => mpGateway().requestWereadJson('weread-list', wereadListUrl(path, params)))
            const info = await client.bookInfo(fakeid)
            if (info.title) verified = { title: info.title, coverImg: info.coverImg, author: info.author }
          } catch { /* 校验失败不阻断识别——标识本身已确定 */ }
        }
        outJson({
          ok: true,
          account: {
            fakeid,
            nickname: verified?.title || nickname || fakeid,
            ...(verified ? { wereadCover: verified.coverImg, wereadAuthor: verified.author } : {}),
          },
          ...(creds ? {} : { note: '尚未登录微信读书；登录后可自动校验该号是否被微信读书收录' }),
        })
        exitCode = 0
      } catch (e) {
        outJson({ ok: false, error: { code: (e as { code?: string }).code ?? 'MP_API_ERROR', message: (e as Error).message } })
        exitCode = 1
      }
    })

  program
    .command('auth-status')
    .description('查看微信读书登录态（本地读取，零网络请求；--verify 真实续期探测一次）')
    .option('--verify', '真实调用一次微信读书续期接口验证登录态（会顺带续期）')
    .action(async (opts) => {
      const store = wereadCredsStore(userDataDir)
      const creds = await store.read()
      if (!creds) { outJson({ ok: true, present: false, valid: false }); return }
      if (!opts.verify) {
        outJson({ ok: true, present: true, valid: null, checkedAt: creds.updatedAt, name: creds.name, note: '仅确认本地保存了微信读书凭据；--verify 可真实探测' })
        return
      }
      try {
        const fresh = await ensureFreshWereadCreds(store)
        outJson({ ok: true, present: true, valid: true, checkedAt: fresh.updatedAt, name: fresh.name })
      } catch (e) {
        if (e instanceof MpAuthExpired) { outJson({ ok: true, present: true, valid: false, name: creds.name, reason: e.message }); return }
        throw e
      }
    })

  const protection = program.command('protection').description('微信请求保护（子命令:status / pause / resume）')
  protection.command('status').description('查看保护状态（零微信请求）').action(async () => {
    outJson({ ok: true, protection: await mpGateway().status() })
  })
  protection.command('pause').description('立即暂停所有微信请求（零微信请求）').action(async () => {
    outJson({ ok: true, protection: await mpGateway().pause() })
  })
  protection.command('resume').description('恢复请求许可；本动作不会立即访问微信').action(async () => {
    outJson({ ok: true, protection: await mpGateway().resume() })
  })

  program
    .command('crawl')
    .description('按公众号批量下载（当前不可用：微信读书列表接口受服务端限制，见 README 能力边界）')
    .argument('[account]', '账号标识（已停用，仅为兼容保留参数）')
    .option('--fakeid <id>', '同位置参数（兼容旧脚本保留）')
    .option('--count <n>', '最近 N 篇')
    .option('--from <date>', '起始日期 YYYY-MM-DD')
    .option('--to <date>', '结束日期 YYYY-MM-DD')
    .option('--formats <csv>', '逗号分隔：cover,md,html,pdf,meta', 'md,html,meta')
    .option('--no-video', '不下载文中内嵌视频（默认会下；单个视频可达上百 MB）')
    .option('--include <csv>', '仅下载标题含任一关键词的文章（逗号分隔）')
    .option('--exclude <csv>', '排除标题含任一关键词的文章（逗号分隔，优先于 --include）')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async () => {
      // 2026-08-28 停用（服务端按账号封禁列表，批量无解，见 AGENTS.md）；命令名保留给稳定拒绝，零网络
      if (RETIRED_PRIVATE_API_COMMANDS.has('crawl')) {
        outJson(retiredPrivateApiResponse()); exitCode = 2; return
      }
    })

  program
    .command('login')
    .description('扫码登录微信读书（按公众号下载与订阅的登录态；终端显示二维码）')
    .action(async () => {
      const store = wereadCredsStore(userDataDir)
      try {
        const creds = await runWereadLogin(store, {
          runAction: (task) => mpGateway().runAction('weread-auth', 'https://weread.qq.com/api/auth/getLoginUid', task),
          // 登录走 Chromium 网络栈（CLI 同一 Electron 主进程），理由同 weread-net.ts 头注
          http: buildWereadQrFlowHttp(),
        }, {
          onQr: (qr) => {
            void QRCode.toString(qr.confirmUrl, { type: 'terminal', small: true }).then((ascii) => {
              process.stderr.write('\n请用微信扫码，并在手机上确认登录：\n\n' + ascii + '\n')
              process.stderr.write(`（终端二维码扫不动时，可在浏览器打开后扫页面上的码：${qr.confirmUrl}）\n`)
            })
          },
          onState: (s) => { if (s === 'scanned') process.stderr.write('已扫码，等待手机确认…\n') },
        })
        outJson({ ok: true, vid: creds.vid, name: creds.name })
        exitCode = 0
      } catch (e) {
        if (e instanceof WereadLoginCancelled || e instanceof MpAuthExpired && e.message.includes('取消')) {
          outJson({ ok: false, error: { code: 'CANCELLED', message: (e as Error).message } }); exitCode = 2; return
        }
        if (e instanceof MpAuthExpired) { outJson({ ok: false, error: { code: 'LOGIN_FAILED', message: e.message } }); exitCode = 1; return }
        outJson({ ok: false, error: { code: (e as { code?: string }).code ?? 'LOGIN_FAILED', message: (e as Error).message } })
        exitCode = 1
      }
    })

  // 凭据跨机器搬运:headless 环境无法扫码(mac login → export → scp → import)。v0.10.0 起是微信读书凭据形态。
  const sessionCmd = program.command('session').description('微信读书登录态跨机器迁移(子命令:export / import)')
  const cliSessionPath = () => join(userDataDir, 'weread-creds.json')
  sessionCmd
    .command('export')
    .description('导出当前微信读书登录态到文件(等同登录凭证,勿提交仓库/勿外传)')
    .option('-o, --out <file>', '导出路径', './wx-kit-weread-creds.json')
    .action(async (opts) => {
      const store = wereadCredsStore(userDataDir)
      if (!(await store.read())) { outJson({ ok: false, error: { code: 'NO_SESSION', message: '尚未登录,先执行 wx-kit login' } }); exitCode = 1; return }
      const outPath = String(opts.out)
      const { copyFile, chmod } = await import('node:fs/promises')
      await copyFile(cliSessionPath(), outPath)
      await chmod(outPath, 0o600)
      outJson({ ok: true, path: outPath, warning: '此文件等同登录态,勿提交仓库、勿传给不信任的环境,用后即删' })
    })
  sessionCmd
    .command('import')
    .description('从文件导入微信读书登录态（零微信请求；有效性在后续实际操作时确认）')
    .argument('<file>', '来自 session export 的文件')
    .action(async (file: string) => {
      // 读文件→按 weread 凭据形态校验→写盘(0600)。非法内容不触碰既有凭据。
      let parsed: unknown
      try { parsed = JSON.parse(readFileSync(file, 'utf-8')) } catch { outJson({ ok: false, error: { code: 'CLI_ERROR', message: '文件不是合法 JSON' } }); exitCode = 2; return }
      const v = parsed as { accessToken?: unknown; vid?: unknown; refreshToken?: unknown; deviceId?: unknown }
      if (typeof v?.accessToken !== 'string' || !v.accessToken || typeof v?.vid !== 'string' || typeof v?.refreshToken !== 'string') {
        outJson({ ok: false, error: { code: 'CLI_ERROR', message: '不是微信读书登录态文件（缺少 accessToken/vid 等字段；旧版 mp-session.json 已不再适用）' } }); exitCode = 2; return
      }
      const { writeFile } = await import('node:fs/promises')
      await writeFile(cliSessionPath(), JSON.stringify(parsed, null, 2), { mode: 0o600 })
      outJson({ ok: true, valid: null, note: '已导入；未访问微信读书探测有效性，后续实际操作将通过请求保护网关' })
    })

  const library = program.command('library').description('文章库(子命令:list / search / remove / rebuild / export)')
  library
    .command('list')
    .description('列出已下载文章（默认按发布时间降序，最近在前）')
    .option('--account <name>', '按公众号过滤')
    .option('--sort <field>', '排序字段:publish(发布时间) / download(下载时间) / title', 'publish')
    .option('--order <dir>', '升降序:desc / asc', 'desc')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (opts) => {
      const all = await new Library(await resolveRoot(opts.out)).list()
      const items = opts.account ? all.filter((a) => a.account === opts.account) : all
      outJson({ ok: true, items: sortArticles(items, opts.sort, opts.order) })
      exitCode = 0
    })

  library
    .command('search')
    .description('按标题关键词搜索文库（默认按发布时间降序）')
    .argument('<keyword>', '标题关键词（空字符串表示不按标题过滤）')
    .option('--account <name>', '再按公众号名过滤')
    .option('--sort <field>', '排序字段:publish / download / title', 'publish')
    .option('--order <dir>', '升降序:desc / asc', 'desc')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (keyword: string, opts) => {
      const lib = new Library(await resolveRoot(opts.out))
      const hits = await lib.search(keyword)
      const items = opts.account ? hits.filter((a) => a.account === opts.account) : hits
      outJson({ ok: true, items: sortArticles(items, opts.sort, opts.order) })
      exitCode = 0
    })

  library
    .command('remove')
    .description('按 id 删除文库文章（删文件 + 索引 + 历史联动标记已删除）')
    .option('--ids <csv>', '文章 id（逗号分隔）')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (opts) => {
      const ids = opts.ids ? String(opts.ids).split(',').map((s: string) => s.trim()).filter(Boolean) : []
      if (!ids.length) { outJson({ ok: false, error: { code: 'NO_SELECTOR', message: '需指定 --ids' } }); exitCode = 2; return }
      const root = await resolveRoot(opts.out)
      const lib = new Library(root)
      const hist = new History(root)
      let removed = 0
      for (const id of ids) {
        if (await lib.has(id)) { await lib.remove(id); await hist.markDeleted(id); removed++ }
      }
      outJson({ ok: true, removed })
      exitCode = 0
    })

  library
    .command('rebuild')
    .description('从各文章目录的 meta.json 重建文库索引（library.json 损坏时的恢复手段）')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (opts) => {
      const res = await rebuildLibrary(await resolveRoot(opts.out))
      outJson({ ok: true, ...res })
      exitCode = 0
    })

  library
    .command('export')
    .description('把选中的文章导出为 agent 素材清单（JSON 到 stdout）')
    .option('--ids <csv>', '按文章 id 选（逗号分隔）')
    .option('--since <date>', '按下载日期选：YYYY-MM-DD 及之后')
    .option('--account <name>', '按公众号名选（大小写不敏感包含匹配）')
    .option('--all', '导出全库（无选料器时必须显式指定）')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (opts) => {
      const ids = opts.ids ? String(opts.ids).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined
      if (!ids && !opts.since && !opts.account && !opts.all) {
        outJson({ ok: false, error: { code: 'NO_SELECTOR', message: '需指定 --ids / --since / --account 之一，或 --all 导全库' } })
        exitCode = 1
        return
      }
      const all = await new Library(await resolveRoot(opts.out)).list()
      const picked = selectArticles(all, { ids, since: opts.since, account: opts.account, all: opts.all })
      outJson(buildManifest(picked))
      exitCode = 0
    })

  const subscription = program.command('subscription').description('公众号订阅(子命令:list / check-now / digest)')
  subscription
    .command('list')
    .description('列出订阅账号、水位、上次/下次检查与最近检查记录')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (opts) => {
      const s = await settingsFor().get()
      const root = await resolveRoot(opts.out)
      const subs = new Subscriptions(root)
      const { events } = await new History(root, s.historyRetentionDays).list(0, 1_000_000)
      const merged = mergeAccounts(accountsFromHistory(events), await subs.list())
      const lastRunAt = await subs.getLastRunAt()
      const next = s.subscriptionAutoCheck
        ? nextCheckAt(Date.now(), lastRunAt, { mode: s.subscriptionScheduleMode, checkTime: s.subscriptionCheckTime, intervalHours: s.subscriptionIntervalHours })
        : null
      // M56:最近 5 条检查记录(与 GUI 检查记录弹窗同源,全量含下载交付字段)。定时自动下载
      // 发生在 GUI 进程内,这里是 agent 查「最近自动下载了什么」的唯一 CLI 路径——check-now
      // 只报告本次触发的一轮,不回看历史。
      const recentLog = (await subs.getCheckLog()).slice(0, 5)
      outJson({ ok: true, accounts: merged, lastRunAt, nextCheckAt: next, authExpired: false, recentLog })
      exitCode = 0
    })
  subscription
    .command('check-now')
    .description('立即检查一次订阅更新（频控不重试）')
    .option('--accounts <csv>', '只检查指定公众号(逗号分隔 fakeid,默认全部;fakeid 从 subscription list 取)')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (opts) => {
      const s = await settingsFor().get()
      const root = await resolveRoot(opts.out)
      const subs = new Subscriptions(root)
      const downloadedUrls = new Set((await new Library(root).list()).map((article) => sourceUrlKey(article.sourceUrl)))
      const logFilePath = join(userDataDir, 'subscriptions-check.log')
      const fakeids = opts.accounts ? String(opts.accounts).split(',').map((x: string) => x.trim()).filter(Boolean) : undefined
      const downloadRefs = async (refs: import('../core/mp-types').ArticleRef[], formats: DownloadFormat[], source: HistorySource) => {
        const library = new Library(root)
        // 订阅检查没有 --no-video 开关，按设置走（与 GUI 的定时检查一致）
        const ddeps = { ...mpArticleFetchers(), BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot: root, downloadVideos: s.downloadVideos }
        const queue = new DownloadQueue((url, hint, report) => downloadArticle(url, formats, { ...ddeps, onProgress: report }, hint))
        // 透传列表给的文章主键:订阅拿到的是短链,没 hint 会退化成哈希 id → 与「按公众号」抓的同一篇算两篇
        const summary = await queue.run(refs.map((r) => ({ url: r.url, appmsgid: r.appmsgid, itemidx: r.itemidx })))
        try { await new History(root, s.historyRetentionDays).append(eventFromSummary(randId(), Date.now(), source, formats, summary)) } catch { /* 历史是辅助记录，写失败不阻断 */ }
        return summary
      }
      const list = await wereadListFn(userDataDir, (url) => mpGateway().requestWereadJson('weread-list', url))
      const result = await runSubscriptionCheck('manual', {
        ...(fakeids ? { fakeids } : {}),
        subs, settings: s, list, isRefDownloaded: async (ref) => downloadedUrls.has(sourceUrlKey(ref.url)), downloadRefs,
        log: async (e) => {
          try { await subs.appendCheckLog(e); appendFileSync(logFilePath, formatCheckLogLine(e) + '\n') } catch { /* 留痕失败不阻断 */ }
          process.stderr.write(formatCheckLogLine(e) + '\n')
        },
      })
      // results 是逐号明细(M34):agent 同样需要知道「哪个号新增了几篇、下了几篇」,而不只是总数
      outJson({ ok: true, accounts: result.accounts, newFound: result.newFound, failed: result.failed, results: result.results, ...(result.failures ? { failures: result.failures } : {}), ...(result.note ? { note: result.note } : {}) })
      exitCode = 0
    })

  subscription
    .command('digest')
    .description('按发表日期查询本地订阅文章（默认零网络；仅今天可加 --download 刷新并下载）')
    .requiredOption('--date <date>', '北京时间 YYYY-MM-DD / today / yesterday')
    .option('--accounts <csv>', '指定订阅公众号 fakeid（逗号分隔；默认全部已订阅账号）')
    .option('--download', '仅限今天：刷新最新 cover、下载缺失文章，再从文库返回当天清单')
    .option('--formats <csv>', '仅配合 --download:cover,md,html,pdf,meta(默认跟随设置)')
    .option('--no-video', '仅配合 --download:不下载文中视频')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (o) => {
      const now = Date.now()
      let when
      try { when = resolveDigestDate(String(o.date), now) }
      catch (error) {
        outJson({ ok: false, error: { code: 'BAD_DATE', message: (error as Error).message } })
        exitCode = 2; return
      }
      if (o.download && when.date !== resolveDigestDate('today', now).date) {
        outJson({ ok: false, error: {
          code: 'DOWNLOAD_TODAY_ONLY',
          message: '--download 仅支持北京时间今天；当前 cover 无法回补历史，请去掉 --download 查询本地文库。',
        } })
        exitCode = 2; return
      }
      const root = await resolveRoot(o.out)
      const subs = new Subscriptions(root)
      const library = new Library(root)
      const only = o.accounts
        ? String(o.accounts).split(',').map((id) => normalizeAccountKey(id.trim())).filter(Boolean)
        : null
      const accounts = (await subs.list()).filter((a) => a.subscribed && (!only || only.includes(a.fakeid)))
      let failures: DigestFailure[] = []

      // 纯本地分支不检查凭据、不构造网关；全局自动下载设置不改变本次明确的 flag。
      if (o.download && accounts.length) {
        const settings = await settingsFor().get()
        const formats = o.formats ? parseFormats(String(o.formats)) : settings.defaultFormats
        if (!await wereadCredsStore(userDataDir).read()) {
          outJson({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请先执行 wx-kit login，再刷新下载；不带 --download 的本地查询无需登录。' } })
          exitCode = 2; return
        }
        const client = makeWereadClient((path, params) =>
          mpGateway().requestWereadJson('weread-list', wereadListUrl(path, params)))
        const deps = {
          ...mpArticleFetchers(), BrowserWindowCtor: BrowserWindow, library, libraryRoot: root,
          now: () => new Date().toISOString(),
          downloadVideos: o.video === false ? false : settings.downloadVideos,
        }
        failures = await refreshDigest(accounts, {
          latest: (fakeid) => client.getLatestArticle(fakeid),
          readLibrary: () => library.list(),
          download: (account, url, hint, report) => downloadArticle(url, formats, { ...deps, accountId: account.fakeid, onProgress: report }, hint),
          onAccount: (account, index, total) => process.stderr.write(`[${index}/${total}] 刷新 ${account.nickname}\n`),
          onProgress: (event) => process.stderr.write(`↓ ${event.message ?? event.phase}\n`),
        })
      }

      // 下载后重读；日期过滤只依据入库的真实发表时间，不能筛选 cover 的发现时间。
      const result = subscriptionDigest({
        accounts, date: when.date, library: await library.list(),
        contentPathOf: (article) => {
          const path = join(article.dir, 'content.md')
          return article.formats.includes('md') && existsSync(path) ? path : undefined
        },
      })
      if (failures.length) { result.ok = false; result.failures = failures }
      outJson(result)
      exitCode = result.ok ? 0 : 1
    })

  program
    .command('update')
    .description('检查是否有新版本(只检查,不自动升级;给出按安装渠道的升级命令)')
    .option('--check', '查询最新版本(默认行为,写出来更明确)')
    .action(async () => {
      const current = opts.version ?? '0.0.0-dev'
      const info = await checkUpdate(current)
      if (!info) {
        outJson({ ok: false, error: { code: 'UPDATE_CHECK_FAILED', message: '查询失败(网络不可达或 GitHub 限流)' } })
        exitCode = 1
        return
      }
      const channel = detectChannel({ platform: process.platform, existsSync })
      outJson({
        ok: true, current: info.current, latest: info.latest, updateAvailable: info.hasUpdate,
        channel, upgradeCommand: upgradeCommand(channel),
        publishedAt: info.publishedAt,
        ...(info.hasUpdate ? { assets: info.assets.map((a) => a.name) } : {}),
      })
      exitCode = 0
    })

  const site = program.command('site').description('个人站点同步(子命令:sync)')
  site
    .command('sync')
    .description('把文库文章按站点发布规范生成到 content/posts(纯本地,不联网)')
    .option('--ids <csv>', '按文章 id 选(逗号分隔;id 从 library list 取)')
    .option('--since <date>', '按下载日期选:YYYY-MM-DD 及之后')
    .option('--account <name>', '按公众号名选(大小写不敏感包含匹配)')
    .option('--all', '选择全库(无选料器时必须显式指定)')
    .option('--slug <slug>', '单篇的 slug(仅当选中恰好 1 篇时可用)')
    .option('--slugs <csv>', '批量 slug 映射:<id>=<slug>,<id>=<slug>')
    .option('--slugs-file <file>', '每行 "<id> <slug>" 的文件(# 开头为注释)')
    .option('--posts-dir <dir>', '站点 content/posts 目录(默认取设置 siteSyncPostsDir)')
    .option('-o, --out <dir>', '文章库根目录(默认取设置中的库位置)')
    .action(async (opts) => {
      const ids = opts.ids ? String(opts.ids).split(',').map((x: string) => x.trim()).filter(Boolean) : undefined
      if (!ids && !opts.since && !opts.account && !opts.all) {
        outJson({ ok: false, error: { code: 'NO_SELECTOR', message: '需指定 --ids / --since / --account 之一,或 --all' } })
        exitCode = 2; return
      }
      const s = await settingsFor().get()
      const postsRoot = opts.postsDir ?? s.siteSyncPostsDir
      if (!postsRoot) {
        outJson({ ok: false, error: { code: 'CLI_ERROR', message: '未配置站点目录:用 --posts-dir 指定,或 settings set siteSyncPostsDir <dir>' } })
        exitCode = 2; return
      }
      const all = await new Library(await resolveRoot(opts.out)).list()
      const picked = selectArticles(all, { ids, since: opts.since, account: opts.account, all: opts.all })
      if (!picked.length) {
        outJson({ ok: false, error: { code: 'NOT_FOUND', message: '选料结果为空' } }); exitCode = 1; return
      }

      // slug 来源:--slug(单篇) / --slugs(id=slug 映射) / --slugs-file(每行 "<id> <slug>")
      const slugMap = new Map<string, string>()
      if (opts.slugsFile) {
        for (const line of readFileSync(opts.slugsFile, 'utf-8').split(/\r?\n/)) {
          const t = line.trim()
          if (!t || t.startsWith('#')) continue
          const [id, slug] = t.split(/\s+/)
          if (id && slug) slugMap.set(id, slug)
        }
      }
      if (opts.slugs) {
        for (const pair of String(opts.slugs).split(',')) {
          const [id, slug] = pair.split('=').map((x: string) => x.trim())
          if (id && slug) slugMap.set(id, slug)
        }
      }
      if (opts.slug) {
        if (picked.length !== 1) {
          outJson({ ok: false, error: { code: 'CLI_ERROR', message: `--slug 仅适用于选中 1 篇的情况(当前 ${picked.length} 篇),请用 --slugs 或 --slugs-file` } })
          exitCode = 2; return
        }
        slugMap.set(picked[0].id, String(opts.slug))
      }
      const missing = picked.filter((m) => !slugMap.get(m.id))
      if (missing.length) {
        outJson({ ok: false, error: {
          code: 'CLI_ERROR',
          message: `${missing.length} 篇缺少 slug,请用 --slugs <id>=<slug> 或 --slugs-file 提供`,
          missing: missing.map((m) => ({ id: m.id, title: m.title })),
        } })
        exitCode = 2; return
      }

      const summary = await syncToSite(picked.map((m) => ({ meta: m, slug: slugMap.get(m.id)! })), postsRoot)
      outJson({ ok: summary.failed === 0, ...summary })
      exitCode = summary.failed === 0 ? 0 : 1
    })

  const settings = program.command('settings').description('读写应用设置(子命令:get / set)')
  settings
    .command('get')
    .description('输出全部设置，或单个键的值')
    .argument('[key]', '设置键名')
    .action(async (key: string | undefined) => {
      const all = await settingsFor().get()
      if (key === undefined) {
        outJson({ ok: true, settings: all }); return
      }
      if (!(key in all)) { outJson({ ok: false, error: { code: 'CLI_ERROR', message: `未知设置键:${key}` } }); exitCode = 2; return }
      outJson({ ok: true, key, value: (all as unknown as Record<string, unknown>)[key] })
    })
  settings
    .command('set')
    .description('设置一个键的值（仅开放用户可配置键）')
    .argument('<key>', '设置键名')
    .argument('<value>', '值（布尔用 true/false，格式用逗号分隔）')
    .action(async (key: string, value: string) => {
      const parsed = parseSettingAssignment(key, value)
      if (!parsed.ok) { outJson({ ok: false, error: { code: 'CLI_ERROR', message: parsed.error } }); exitCode = 2; return }
      const next = await settingsFor().save(parsed.patch)
      outJson({ ok: true, settings: next })
    })

  program
    .command('version')
    .description('输出版本号')
    .action(() => { process.stdout.write((opts.version ?? '0.0.0-dev') + '\n') })

  try {
    await program.parseAsync(argv, { from: 'user' })
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'commander.helpDisplayed' || code === 'commander.help' || code === 'commander.version') {
      // help/version already printed to stdout; success, no JSON error
    } else {
      process.stdout.write(JSON.stringify({ ok: false, error: { code: 'CLI_ERROR', message: (err as Error).message } }) + '\n')
      exitCode = 2
    }
  }
  return exitCode
}
