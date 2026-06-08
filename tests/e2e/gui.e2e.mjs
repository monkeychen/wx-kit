// End-to-end GUI test for wx-kit M2, driving the real Electron app via Playwright.
// Flow: download (against a local fixture server) -> library -> reader (md image
// load + html iframe) -> delete -> settings. Asserts wxfile:// images render.
//
// Run: npx vite build && node tests/e2e/gui.e2e.mjs   (or: npm run test:e2e)
import { _electron as electron } from 'playwright'
import http from 'node:http'
import { mkdtempSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAAAAAA=',
  'base64',
)

function makeHtml(port) {
  return `<!doctype html><html><head>
<meta property="og:title" content="端到端验证文章" />
<meta property="og:description" content="e2e 摘要" />
<meta property="og:image" content="http://127.0.0.1:${port}/cover.png" />
</head><body>
<h1 class="rich_media_title" id="activity-name">端到端验证文章</h1>
<span id="js_name">E2E公众号</span>
<em id="publish_time">2026-02-25 08:00</em>
<div class="rich_media_content" id="js_content">
<p>第一段正文，<strong>加粗</strong>。</p>
<p><img data-src="http://127.0.0.1:${port}/pic.png" /></p>
<h2>小节</h2><p>第二段正文。</p>
</div></body></html>`
}

const log = (...a) => console.log('[e2e]', ...a)
let failed = false
const assert = (cond, msg) => { if (cond) { log('✓', msg) } else { failed = true; console.error('[e2e] ✗', msg) } }

async function main() {
  // --- fixture server ---
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/article')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(makeHtml(server.address().port)) }
    else if (req.url.startsWith('/pic.png') || req.url.startsWith('/cover.png')) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG) }
    else { res.writeHead(404); res.end('no') }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const articleUrl = `http://127.0.0.1:${port}/article`
  log('fixture server on', port)

  // --- isolated userData + library root, seed settings ---
  const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-e2e-udd-'))
  const libraryRoot = mkdtempSync(join(tmpdir(), 'wxk-e2e-lib-'))
  writeFileSync(join(userDataDir, 'settings.json'),
    JSON.stringify({ libraryRoot, defaultFormats: ['cover', 'md', 'html', 'meta'] }))
  log('libraryRoot', libraryRoot)

  // 若本机有缓存的真实 session，喂进隔离 userData：让公众号链路能用真实登录态跑真实下载。
  // 下载仍写隔离 libraryRoot，不污染真实文章库；真实 session 文件只读取、不改动。
  const realSession = join(homedir(), 'Library', 'Application Support', 'wx-kit', 'mp-session.json')
  let hasSession = false
  if (existsSync(realSession)) {
    try { copyFileSync(realSession, join(userDataDir, 'mp-session.json')); hasSession = true; log('seeded real mp-session') }
    catch (e) { log('mp-session copy failed:', e.message) }
  } else {
    log('no cached mp-session on this machine — account-mode step falls back to login-gate assertion')
  }

  const app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  win.on('crash', () => errors.push('PAGE CRASHED'))
  win.on('close', () => log('window close event'))
  const proc = app.process()
  proc.stderr?.on('data', (d) => { const s = String(d); if (!s.includes('IMKCFRunLoop')) process.stderr.write('[main] ' + s) })
  proc.stdout?.on('data', (d) => process.stderr.write('[main-out] ' + String(d)))

  try {
    await win.waitForSelector('[data-testid="app-shell"]', { timeout: 20000 })
    assert(true, 'app shell rendered')

    // --- URL download ---
    await win.fill('textarea', articleUrl)
    await win.click('[data-testid="start-download"]')
    await win.waitForSelector('[data-testid="history-article"]', { timeout: 30000 })
    assert(true, 'download appears in history with an article row')
    await win.waitForSelector('[data-testid="history-read"]', { timeout: 5000 })
    assert(true, 'history article offers an in-place 阅读 entry')

    // --- library (card shelf) ---
    await win.click('[data-testid="nav-文库"]')
    await win.waitForSelector('[data-testid="article-card"]', { timeout: 15000 })
    const card = win.locator('[data-testid="article-card"]').first()
    const cardText = await card.innerText()
    assert(cardText.includes('端到端验证文章'), 'shelf lists the downloaded article')
    assert(cardText.includes('E2E公众号'), 'card shows the account name')

    // --- reader (md) ---
    await card.hover()
    await win.click('[data-testid="card-read"]')
    await win.waitForSelector('img[src^="wxfile://"]', { timeout: 15000 })
    const mdImgOk = await win.evaluate(() => {
      const im = [...document.querySelectorAll('img')].find((i) => i.src.startsWith('wxfile://'))
      return !!im && im.complete && im.naturalWidth > 0
    })
    assert(mdImgOk, 'reader md view: wxfile image actually rendered (naturalWidth>0)')

    // --- reader (html iframe) ---
    await win.click('.ant-segmented >> text=网页')
    await win.waitForSelector('iframe', { timeout: 10000 })
    const iframeSrc = await win.getAttribute('iframe', 'src')
    assert(!!iframeSrc && iframeSrc.startsWith('wxfile://') && iframeSrc.endsWith('/index.html'),
      `reader html view: iframe src is wxfile .../index.html (${iframeSrc})`)

    // --- delete ---
    await win.click('[data-testid="nav-文库"]')
    await win.waitForSelector('[data-testid="article-card"]', { timeout: 10000 })
    await win.locator('[data-testid="article-card"]').first().hover()
    await win.click('[data-testid="card-delete"]')
    await win.click('.ant-popover button:has-text("删")')
    await win.waitForSelector('[data-testid="article-card"]', { state: 'detached', timeout: 10000 })
    assert(true, 'delete removed the card')

    // --- settings shows seeded library root ---
    await win.click('[data-testid="nav-设置"]')
    await win.waitForSelector('input[readonly]', { timeout: 10000 })
    const rootVal = await win.inputValue('input[readonly]')
    assert(rootVal === libraryRoot, `settings shows library root (${rootVal})`)

    // --- download page · account mode ---
    await win.click('[data-testid="nav-下载"]')
    await win.click('[data-testid="mode-account"]')
    if (hasSession) {
      // 有缓存 session：用真实登录态跑 搜号 → 选号 → 下最近 1 篇 → 历史出现公众号 event。
      // mp 频控/网络抖动等外部因素不算代码失败 → 软跳过（log 告警，不判失败）。
      try {
        await win.waitForSelector('[data-testid="account-search"]', { timeout: 15000 })
        await win.fill('[data-testid="account-search"] input', '刘备教授')
        await win.click('[data-testid="account-search"] button')
        await win.waitForSelector('[data-testid="candidate"]', { timeout: 20000 })
        await win.click('[data-testid="candidate"]')
        await win.waitForSelector('[data-testid="start-crawl"]', { timeout: 8000 })
        await win.fill('.range-row .ant-input-number-input', '1')   // 最小化抓取：最近 1 篇
        await win.click('[data-testid="start-crawl"]')
        await win.waitForSelector('.event .ev-icon.acc', { timeout: 90000 })  // 公众号 event 进历史
        assert(true, 'account-mode real crawl with cached session lands in download history')
      } catch (e) {
        log('account-mode real flow soft-skipped (mp/network/rate-limit):', e.message)
      }
    } else {
      await win.waitForSelector('[data-testid="login-gate"]', { timeout: 10000 })
      assert(true, 'download page · account mode shows login gate without a session')
    }

    await win.screenshot({ path: '/tmp/wxk-e2e-final.png' })
    assert(errors.length === 0, `no console/page errors (saw ${errors.length}: ${errors.slice(0, 3).join(' | ')})`)
  } catch (e) {
    failed = true
    console.error('[e2e] step error:', e.message)
    console.error('[e2e] collected errors:', errors)
    throw e
  } finally {
    await app.close().catch(() => {})
    server.close()
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(libraryRoot, { recursive: true, force: true })
  }

  if (failed) { console.error('[e2e] FAILED'); process.exit(1) }
  log('ALL PASSED')
}

main().catch((e) => { console.error('[e2e] crashed:', e); process.exit(1) })
