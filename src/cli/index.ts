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

/** 解析 CLI 参数并执行；返回退出码 */
export async function runCli(argv: string[]): Promise<number> {
  const program = new Command()
  program.name('wx-kit').description('微信百宝箱 CLI').exitOverride()
  program.configureOutput({
    writeOut: (s) => process.stderr.write(s),
    writeErr: (s) => process.stderr.write(s),
  })

  let exitCode = 0

  program
    .command('download')
    .description('下载一个或多个微信文章 URL')
    .option('-u, --url <url...>', '文章 URL（可多次）', [])
    .option('-f, --urls-file <file>', '每行一个 URL 的文件')
    .option('--formats <csv>', '逗号分隔：cover,md,html,pdf,meta', 'md,html,meta')
    .option('-o, --out <dir>', '文章库根目录', defaultLibraryRoot())
    .action(async (opts) => {
      const urls: string[] = [...(opts.url ?? [])]
      if (opts.urlsFile) {
        urls.push(...readFileSync(opts.urlsFile, 'utf-8').split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean))
      }
      if (!urls.length) throw new Error('no urls; use --url or --urls-file')
      const formats = parseFormats(opts.formats)
      const library = new Library(opts.out)
      const deps = { fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot: opts.out }

      const queue = new DownloadQueue(
        (url) => downloadArticle(url, formats, deps),
        (e) => process.stderr.write(`[${e.completed}/${e.total}] ${e.phase} ${e.currentUrl}\n`),
      )
      const summary = await queue.run(urls)
      out(summary)
      exitCode = summary.ok ? 0 : 1
    })

  try {
    await program.parseAsync(argv, { from: 'user' })
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'commander.helpDisplayed' || code === 'commander.help' || code === 'commander.version') {
      // help/version already printed to stderr; success, no JSON error
    } else {
      process.stdout.write(JSON.stringify({ ok: false, error: { code: 'CLI_ERROR', message: (err as Error).message } }) + '\n')
      exitCode = 2
    }
  }
  return exitCode
}
