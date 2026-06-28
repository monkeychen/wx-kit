// src/cli/index.ts
import { Command } from 'commander'
import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import type { DownloadFormat, DownloadSummary } from '../core/types'
import { ALL_FORMATS } from '../core/types'
import { fetchHtml, fetchBinary } from '../core/fetch-html'
import { Library } from '../core/library'
import { DownloadQueue } from '../core/download-queue'
import { downloadArticle } from '../core/download-article'
import { getSession, login } from '../../electron/services/mp-auth'
import { makeMpFetch } from '../../electron/services/mp-fetch'
import { searchAccount } from '../core/mp-client'
import { crawlAccount } from '../core/mp-crawl'
import { MpAuthExpired } from '../core/mp-errors'
import { rebuildLibrary } from '../core/rebuild-library'
import { selectArticles, buildManifest } from '../core/material-export'
import { SettingsService } from '../../electron/services/settings'
import { parseSettingAssignment } from '../../electron/services/settings-cli'

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
  program.name('wx-kit').description('微信百宝箱 CLI').exitOverride()
  program.version(opts.version ?? '0.0.0-dev', '-v, --version', '输出版本号')
  program.configureOutput({
    writeOut: (s) => process.stdout.write(s),   // help/version 是主动查询,走 stdout
    writeErr: (s) => process.stderr.write(s),   // 报错 usage 走 stderr
  })

  // opts.userDataDir 由 main.ts 注入真实 app.getPath('userData')，与 GUI 同源；
  // '.wx-kit' 仅为 opts 缺省时的安全兜底，实际运行不会用到
  const settingsFor = () =>
    new SettingsService(opts.userDataDir ?? join(homedir(), '.wx-kit'), defaultLibraryRoot())
  const resolveRoot = async (optOut?: string): Promise<string> =>
    optOut ?? (await settingsFor().get()).libraryRoot

  let exitCode = 0

  program
    .command('download')
    .description('下载一个或多个微信文章 URL')
    .option('-u, --url <url...>', '文章 URL（可多次）', [])
    .option('-f, --urls-file <file>', '每行一个 URL 的文件')
    .option('--formats <csv>', '逗号分隔：cover,md,html,pdf,meta', 'md,html,meta')
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
      const deps = { fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot: root }

      const queue = new DownloadQueue(
        (url) => downloadArticle(url, formats, deps),
        (e) => process.stderr.write(`[${e.completed}/${e.total}] ${e.phase} ${e.currentUrl}\n`),
      )
      const summary = await queue.run(urls)
      out(summary)
      exitCode = summary.ok ? 0 : 1
    })

  program
    .command('search')
    .description('搜索公众号，返回候选列表')
    .argument('<name>', '公众号名称')
    .action(async (name: string) => {
      const session = getSession()
      if (!session) { outJson({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请先执行 wx-kit login' } }); exitCode = 2; return }
      try {
        const list = await searchAccount(makeMpFetch(session), session.token, name)
        outJson({ ok: true, list })
      } catch (e) {
        if (e instanceof MpAuthExpired) { outJson({ ok: false, error: { code: 'AUTH_REQUIRED', message: '登录态失效，请重新 login' } }); exitCode = 2 }
        else { outJson({ ok: false, error: { code: 'MP_API_ERROR', message: (e as Error).message } }); exitCode = 1 }
      }
    })

  program
    .command('auth-status')
    .description('查询登录态是否有效（会做一次廉价真探测）')
    .action(async () => {
      const session = getSession()
      if (!session) { outJson({ ok: true, valid: false }); return }
      try { await searchAccount(makeMpFetch(session), session.token, '腾讯'); outJson({ ok: true, valid: true }) }
      catch (e) { if (e instanceof MpAuthExpired) outJson({ ok: true, valid: false }); else { outJson({ ok: false, error: { code: 'MP_API_ERROR', message: (e as Error).message } }); exitCode = 1 } }
    })

  program
    .command('crawl')
    .description('批量爬取某公众号')
    .argument('[name]', '公众号名称（或用 --fakeid）')
    .option('--fakeid <id>', '直接指定 fakeid（来自 search）')
    .option('--count <n>', '最近 N 篇')
    .option('--from <date>', '起始日期 YYYY-MM-DD')
    .option('--to <date>', '结束日期 YYYY-MM-DD')
    .option('--formats <csv>', '逗号分隔：cover,md,html,pdf,meta', 'md,html,meta')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (name: string | undefined, opts) => {
      const session = getSession()
      if (!session) { outJson({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请先执行 wx-kit login' } }); exitCode = 2; return }
      const range = opts.count ? { count: Number(opts.count) }
        : (opts.from && opts.to) ? { from: String(opts.from), to: String(opts.to) }
        : null
      if (!range) { outJson({ ok: false, error: { code: 'CLI_ERROR', message: '需要 --count 或 --from/--to' } }); exitCode = 2; return }
      const mpFetch = makeMpFetch(session)
      try {
        let fakeid = opts.fakeid as string | undefined
        if (!fakeid) {
          if (!name) { outJson({ ok: false, error: { code: 'CLI_ERROR', message: '需要 <name> 或 --fakeid' } }); exitCode = 2; return }
          const cands = await searchAccount(mpFetch, session.token, name)
          if (cands.length === 0) { outJson({ ok: false, error: { code: 'NOT_FOUND', message: `未找到公众号：${name}` } }); exitCode = 1; return }
          if (cands.length > 1) { outJson({ ok: false, error: { code: 'AMBIGUOUS', message: '多个匹配，请用 --fakeid', candidates: cands } }); exitCode = 2; return }
          fakeid = cands[0].fakeid
        }
        const formats = parseFormats(opts.formats)
        const root = await resolveRoot(opts.out)
        const library = new Library(root)
        const ddeps = { fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot: root }
        const summary = await crawlAccount(fakeid, range, {
          mpFetch, token: session.token,
          downloadOne: (url) => downloadArticle(url, formats, ddeps),
          onProgress: (e) => process.stderr.write(`[${e.completed}/${e.total}] ${e.phase} ${e.currentUrl}\n`),
        })
        outJson(summary)
        exitCode = summary.ok ? 0 : 1
      } catch (e) {
        const code = (e as { code?: string }).code ?? 'MP_API_ERROR'
        outJson({ ok: false, error: { code, message: (e as Error).message } })
        exitCode = code === 'AUTH_REQUIRED' ? 2 : 1
      }
    })

  program
    .command('login')
    .description('打开扫码登录窗口，持久化 session')
    .action(async () => {
      try { await login(); outJson({ ok: true }) }
      catch (e) {
        const cancelled = (e as Error).message === 'CANCELLED'
        outJson({ ok: false, error: { code: cancelled ? 'CANCELLED' : 'LOGIN_FAILED', message: (e as Error).message } })
        exitCode = cancelled ? 2 : 1
      }
    })

  const library = program.command('library').description('文章库')
  library
    .command('list')
    .description('列出已下载文章')
    .option('--account <name>', '按公众号过滤')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (opts) => {
      const all = await new Library(await resolveRoot(opts.out)).list()
      const items = opts.account ? all.filter((a) => a.account === opts.account) : all
      outJson({ ok: true, items })
      exitCode = 0
    })

  library
    .command('search')
    .description('按标题关键词搜索文库')
    .argument('<keyword>', '标题关键词（空字符串表示不按标题过滤）')
    .option('--account <name>', '再按公众号名过滤')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (keyword: string, opts) => {
      const lib = new Library(await resolveRoot(opts.out))
      const hits = await lib.search(keyword)
      const items = opts.account ? hits.filter((a) => a.account === opts.account) : hits
      outJson({ ok: true, items })
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

  const settings = program.command('settings').description('读写应用设置')
  settings
    .command('get')
    .description('输出全部设置，或单个键的值')
    .argument('[key]', '设置键名')
    .action(async (key: string | undefined) => {
      const all = await settingsFor().get()
      if (key === undefined) { outJson({ ok: true, settings: all }); return }
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
