// 真实微信文章 URL 的 GUI 端到端验收。
// 与 gui.e2e.mjs 的本地 fixture 流程分开：本脚本明确访问真实文章页，只在里程碑/发版验收时运行。
// 可用 WX_KIT_LIVE_ARTICLE_URL 覆盖默认样本。
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const articleUrl = process.env.WX_KIT_LIVE_ARTICLE_URL
  ?? 'https://mp.weixin.qq.com/s/th7sbu0S_FohVpPo0m3Xqw'

const log = (...args) => console.log('[live-e2e]', ...args)
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
  log('✓', message)
}

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-live-e2e-udd-'))
  const libraryRoot = mkdtempSync(join(tmpdir(), 'wxk-live-e2e-lib-'))
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    libraryRoot,
    defaultFormats: ['cover', 'md', 'html', 'meta'],
    downloadVideos: true,
    cliLinkPrompted: true,
    updateCheckEnabled: false,
  }))

  log('article', articleUrl)
  log('isolated library', libraryRoot)

  const app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
    env: { ...process.env },
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`))
  win.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })

  try {
    await win.waitForSelector('[data-testid="app-shell"]', { timeout: 20_000 })
    await win.fill('[data-testid="url-input"]', articleUrl)
    await win.click('[data-testid="start-download"]')

    const event = win.locator('[data-testid="history-event"]').first()
    await event.waitFor({ state: 'visible', timeout: 180_000 })
    await event.locator('[data-testid="history-article"]').first().waitFor({ state: 'visible', timeout: 20_000 })
    const eventText = await event.innerText()
    assert(eventText.includes('1 成功'), `真实文章下载成功（${eventText.split('\n').slice(0, 5).join(' / ')}）`)
    assert(!eventText.includes('失败：'), '下载历史没有失败项')
    assert(await event.locator('[data-testid="history-read"]').first().isVisible(), '下载历史提供阅读入口')

    const library = JSON.parse(readFileSync(join(libraryRoot, 'library.json'), 'utf8'))
    assert(Array.isArray(library.articles) && library.articles.length === 1, '真实文章已写入 library.json')
    const article = library.articles[0]
    assert(Boolean(article.id && article.title && article.dir), '文库元信息包含 id、标题和目录')
    assert(article.formats.includes('md') && article.formats.includes('html') && article.formats.includes('meta'),
      'Markdown、HTML 和元信息格式均已落盘')

    const articleDir = article.dir
    assert(existsSync(join(articleDir, 'content.md')), 'content.md 存在')
    assert(existsSync(join(articleDir, 'index.html')), 'index.html 存在')
    assert(existsSync(join(articleDir, 'meta.json')), 'meta.json 存在')
    assert(readFileSync(join(articleDir, 'content.md'), 'utf8').trim().length > 20, 'Markdown 正文不是空壳')

    const mediaFiles = readdirSync(articleDir).filter((name) => name.startsWith('cover.'))
    const imagesDir = join(articleDir, 'images')
    if (existsSync(imagesDir)) mediaFiles.push(...readdirSync(imagesDir).map((name) => `images/${name}`))
    assert(mediaFiles.length > 0, `文章媒体已本地化（${mediaFiles.slice(0, 5).join(', ')}）`)

    const history = JSON.parse(readFileSync(join(libraryRoot, 'history.json'), 'utf8'))
    assert(history.events?.length === 1 && history.events[0].succeeded === 1, '真实下载已写入 history.json')

    await event.locator('[data-testid="history-read"]').first().click()
    await win.waitForSelector('.reader-title', { timeout: 20_000 })
    assert((await win.locator('.reader-title').innerText()) === article.title, '阅读器标题与文库一致')
    await win.waitForSelector('.prose', { timeout: 20_000 })
    assert((await win.locator('.prose').innerText()).trim().length > 20, '阅读器成功呈现真实正文')

    const auditPath = join(userDataDir, 'mp-request-audit.log')
    const audit = existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : ''
    assert(!audit.includes('/cgi-bin/'), '真实下载未调用公众号后台 cgi-bin 私有接口')
    assert(errors.length === 0, `页面与控制台无错误（${errors.length}）`)
  } finally {
    await app.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(libraryRoot, { recursive: true, force: true })
  }

  log('ALL PASSED')
}

main().catch((error) => {
  console.error('[live-e2e] FAILED:', error)
  process.exit(1)
})
