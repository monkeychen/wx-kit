// End-to-end GUI test for wx-kit, driving the real Electron app via Playwright.
// Covers v0.2.0 feature points (M5–M9):
//   M5 IA (下载双模式 / 文库 / 设置导航)
//   M6 下载闭环 + 历史 (就地阅读/文件夹 · 复制下载项 · 已存在跳过 · 失败重试)
//   M7 反馈 (失败项话术/重试)
//   M9 文库组织 (排序 · 筛选 · 分组 · 卡片⇄列表 · 单击选中/双击阅读 · 批量删除)
//   + 阅读器 wxfile:// 图片/iframe · 设置库根 · 公众号真实抓取(软跳过)
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

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAAAAAA=',
  'base64',
)

// 多文章夹具：跨 2 个公众号 + 不同发布时间，喂文库的排序/筛选/分组；外加一篇无标题的失败页。
const ARTICLES = {
  a1: { title: '阿尔法·甲', account: '甲号', pub: '2026-03-01 08:00' },
  a2: { title: '贝塔·甲', account: '甲号', pub: '2026-03-05 09:00' },
  a3: { title: '伽马·乙', account: '乙号', pub: '2026-02-10 10:00' },
  bad: { title: '', account: '', pub: '' },   // 无标题 → 解析失败 → 失败项
}

function makeHtml(port, art) {
  const titleTag = art.title ? `<h1 class="rich_media_title" id="activity-name">${art.title}</h1>` : ''
  return `<!doctype html><html><head>
${art.title ? `<meta property="og:title" content="${art.title}" />` : ''}
<meta property="og:image" content="http://127.0.0.1:${port}/cover.png" />
</head><body>
${titleTag}
<span id="js_name">${art.account}</span>
<em id="publish_time">${art.pub}</em>
<div class="rich_media_content" id="js_content">
<p>正文，<strong>加粗</strong>。</p>
<p><img data-src="http://127.0.0.1:${port}/pic.png" /></p>
<h2>小节</h2><p>第二段。</p>
</div></body></html>`
}

const log = (...a) => console.log('[e2e]', ...a)
let failed = false
const assert = (cond, msg) => { if (cond) { log('✓', msg) } else { failed = true; console.error('[e2e] ✗', msg) } }

async function main() {
  // --- fixture server: /article/<id> (按路径区分，因 articleId 回退归一 origin+pathname、忽略 query) ---
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    if (u.pathname.startsWith('/article/')) {
      const art = ARTICLES[u.pathname.slice('/article/'.length)] ?? ARTICLES.a1
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(makeHtml(server.address().port, art))
    } else if (u.pathname === '/pic.png' || u.pathname === '/cover.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG)
    } else { res.writeHead(404); res.end('no') }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const urlOf = (id) => `http://127.0.0.1:${port}/article/${id}`
  log('fixture server on', port)

  // --- isolated userData + library root, seed settings ---
  const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-e2e-udd-'))
  const libraryRoot = mkdtempSync(join(tmpdir(), 'wxk-e2e-lib-'))
  writeFileSync(join(userDataDir, 'settings.json'),
    JSON.stringify({ libraryRoot, defaultFormats: ['cover', 'md', 'html', 'meta'] }))
  log('libraryRoot', libraryRoot)

  const realSession = join(homedir(), 'Library', 'Application Support', 'wx-kit', 'mp-session.json')
  let hasSession = false
  if (existsSync(realSession)) {
    try { copyFileSync(realSession, join(userDataDir, 'mp-session.json')); hasSession = true; log('seeded real mp-session') }
    catch (e) { log('mp-session copy failed:', e.message) }
  } else {
    log('no cached mp-session — account-mode step falls back to login-gate assertion')
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
  const proc = app.process()
  proc.stderr?.on('data', (d) => { const s = String(d); if (!s.includes('IMKCFRunLoop')) process.stderr.write('[main] ' + s) })

  // 改 antd Select（v6：可点根为 .ant-select，选项为 .ant-select-item）：开下拉 → 点选项文本
  const pickSelect = async (testid, text) => {
    await win.click(`[data-testid="${testid}"] .ant-select`)
    const opt = win.locator(`.ant-select-dropdown:visible .ant-select-item:has-text("${text}")`).first()
    await opt.waitFor({ state: 'visible', timeout: 5000 })
    await opt.click()
    await win.waitForTimeout(180)
  }
  const firstCardText = () => win.locator('[data-testid="article-card"]').first().innerText()

  try {
    await win.waitForSelector('[data-testid="app-shell"]', { timeout: 20000 })
    assert(true, 'app shell rendered')

    // ============ M6 · URL 批量下载 → 历史就地确认 ============
    await win.fill('textarea', [urlOf('a1'), urlOf('a2'), urlOf('a3')].join('\n'))
    await win.click('[data-testid="start-download"]')
    await win.waitForSelector('[data-testid="history-event"]', { timeout: 30000 })
    await win.waitForSelector('[data-testid="history-article"]', { timeout: 10000 })
    const topEvent = () => win.locator('[data-testid="history-event"]').first()
    const artCount = await topEvent().locator('[data-testid="history-article"]').count()
    assert(artCount === 3, `url batch landed 3 articles in one history event (got ${artCount})`)
    assert(await topEvent().locator('[data-testid="history-read"]').first().isVisible(), 'history article offers in-place 阅读')
    assert((await topEvent().locator('button:has-text("文件夹")').count()) >= 3, 'history articles offer 文件夹')

    // 复制下载项 → 回填链接框
    await topEvent().locator('.ev-again').click()
    await win.waitForTimeout(200)
    const refilled = await win.inputValue('textarea')
    assert(refilled.includes(urlOf('a1')) && refilled.includes(urlOf('a3')), '复制下载项 refills the URL textarea')

    // 再下同样 3 篇 → 已存在跳过
    await win.click('[data-testid="start-download"]')
    await win.waitForTimeout(1500)
    assert((await topEvent().locator('.badge-skip').count()) >= 1, 're-download marks existing articles 已存在 (skipped)')

    // 失败项：下一篇无标题页 → 失败 + 重试
    await win.fill('textarea', urlOf('bad'))
    await win.click('[data-testid="start-download"]')
    await win.waitForSelector('[data-testid="history-event"] .fail-reason', { timeout: 20000 })
    assert(await topEvent().locator('.fail-reason').first().isVisible(), 'failed download shows a reason in history')
    assert((await topEvent().locator('button.retry, .retry').count()) >= 1, 'failed history item offers 重试')

    // ============ M5 · 设置（库根 + 下载历史区）============
    await win.click('[data-testid="nav-设置"]')
    await win.waitForSelector('input[readonly]', { timeout: 10000 })
    assert((await win.inputValue('input[readonly]')) === libraryRoot, 'settings shows the seeded library root')
    assert((await win.locator('text=下载历史').count()) >= 1, 'settings has a 下载历史 (retention/clear) section')

    // ============ M9 · 文库组织 ============
    await win.click('[data-testid="nav-文库"]')
    await win.waitForSelector('[data-testid="article-card"]', { timeout: 15000 })
    const libCount = await win.locator('[data-testid="article-card"]').count()
    assert(libCount === 3, `library holds the 3 successfully-downloaded articles (got ${libCount})`)
    // 默认按公众号分组：组头出现 甲号 / 乙号
    const heads = await win.locator('.ghead .gname').allInnerTexts()
    assert(heads.includes('甲号') && heads.includes('乙号'), `card view grouped by account (${heads.join('/')})`)

    // 排序：关分组 → 发布时间升序 → 首篇为最早的「伽马·乙」
    await win.click('[data-testid="group-toggle"]')
    await pickSelect('sort-select', '发布时间')
    await win.click('[data-testid="sort-dir"]')   // desc → asc
    await win.waitForTimeout(200)
    assert((await firstCardText()).includes('伽马'), 'sort by publish-time asc puts the oldest article first')
    await win.click('[data-testid="sort-dir"]')   // asc → desc
    await win.waitForTimeout(200)
    assert((await firstCardText()).includes('贝塔'), 'flipping direction puts the newest article first')

    // 筛选：只看「甲号」→ 2 篇、无「伽马」
    await pickSelect('account-select', '甲号')
    await win.waitForTimeout(200)
    const filtered = await win.locator('[data-testid="article-card"]').count()
    const hasGamma = (await win.locator('[data-testid="article-card"]').allInnerTexts()).some((t) => t.includes('伽马'))
    assert(filtered === 2 && !hasGamma, `filter by account narrows to that account (got ${filtered}, gamma=${hasGamma})`)
    await pickSelect('account-select', '全部公众号')

    // 列表视图 + 双击行进入阅读（M9 单击选中、双击阅读）
    await win.click('.ant-segmented label:has-text("列表")')
    await win.waitForSelector('[data-testid="article-row"]', { timeout: 8000 })
    assert(true, 'card⇄list view toggle works (Finder-like rows)')
    await win.locator('[data-testid="article-row"]:has-text("阿尔法")').first().dblclick()
    // --- 阅读器 md：wxfile 图片真渲染 ---
    await win.waitForSelector('img[src^="wxfile://"]', { timeout: 15000 })
    const mdImgOk = await win.evaluate(() => {
      const im = [...document.querySelectorAll('img')].find((i) => i.src.startsWith('wxfile://'))
      return !!im && im.complete && im.naturalWidth > 0
    })
    assert(mdImgOk, 'double-click row opens reader; md wxfile image actually rendered (naturalWidth>0)')
    // --- 阅读器 html iframe ---
    await win.click('.ant-segmented >> text=网页')
    await win.waitForSelector('iframe', { timeout: 10000 })
    const iframeSrc = await win.getAttribute('iframe', 'src')
    assert(!!iframeSrc && iframeSrc.startsWith('wxfile://') && iframeSrc.endsWith('/index.html'),
      `reader html view: iframe src is wxfile .../index.html`)

    // ============ M9 · 批量删除 + 单篇删除 ============
    await win.click('[data-testid="nav-文库"]')   // 回到文库（状态重置为默认 卡片+分组）
    await win.waitForSelector('[data-testid="article-card"]', { timeout: 10000 })
    // 单击选中 2 张 → 批量条 → 批量删除
    await win.locator('[data-testid="article-card"]').nth(0).click()
    await win.locator('[data-testid="article-card"]').nth(1).click()
    await win.waitForSelector('[data-testid="batch-delete"]', { timeout: 5000 })
    assert(true, 'single-click selects cards and reveals the batch bar')
    await win.click('[data-testid="batch-delete"]')
    await win.click('.ant-popover button:has-text("删")')
    await win.waitForTimeout(800)
    const afterBatch = await win.locator('[data-testid="article-card"]').count()
    assert(afterBatch === 1, `batch delete removed 2, 1 remains (got ${afterBatch})`)
    // 单篇删除最后一篇 → 空状态
    await win.locator('[data-testid="article-card"]').first().hover()
    await win.click('[data-testid="card-delete"]')
    await win.click('.ant-popover button:has-text("删")')
    await win.waitForSelector('[data-testid="article-card"]', { state: 'detached', timeout: 10000 })
    assert(true, 'single delete removed the last card (library empty)')

    // ============ M3.5/M6 · 公众号模式（有缓存 session 真跑，否则登录门）============
    await win.click('[data-testid="nav-下载"]')
    await win.click('[data-testid="mode-account"]')
    if (hasSession) {
      try {
        await win.waitForSelector('[data-testid="account-search"]', { timeout: 15000 })
        await win.fill('[data-testid="account-search"] input', '刘备教授')
        await win.click('[data-testid="account-search"] button')
        await win.waitForSelector('[data-testid="candidate"]', { timeout: 20000 })
        await win.click('[data-testid="candidate"]')
        await win.waitForSelector('[data-testid="start-crawl"]', { timeout: 8000 })
        await win.fill('.range-row .ant-input-number-input', '1')
        await win.click('[data-testid="start-crawl"]')
        await win.waitForSelector('.event .ev-icon.acc', { timeout: 90000 })
        assert(true, 'account-mode real crawl with cached session lands in download history')
      } catch (e) {
        log('account-mode real flow soft-skipped (mp/network/rate-limit):', e.message)
      }
    } else {
      await win.waitForSelector('[data-testid="login-gate"]', { timeout: 10000 })
      assert(true, 'account mode shows login gate without a session')
    }

    await win.screenshot({ path: '/tmp/wxk-e2e-final.png' })
    assert(errors.length === 0, `no console/page errors (saw ${errors.length}: ${errors.slice(0, 3).join(' | ')})`)
  } catch (e) {
    failed = true
    await win.screenshot({ path: '/tmp/wxk-e2e-fail.png' }).catch(() => {})
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
