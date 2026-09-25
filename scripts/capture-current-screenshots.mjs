// 驱动真实 Electron 与真实公众号文章 URL，生成当前有效页面截图。
// 默认输出到 output/playwright；确认内容后再把选定图片更新进 docs/screenshots。
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const articleUrl = process.env.WX_KIT_LIVE_ARTICLE_URL
  ?? 'https://mp.weixin.qq.com/s/th7sbu0S_FohVpPo0m3Xqw'
const outputDir = resolve(process.env.WX_KIT_SCREENSHOT_DIR ?? join(projectRoot, 'output', 'playwright'))

const log = (...args) => console.log('[screenshots]', ...args)
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
  log('✓', message)
}

async function settleUi(win, clearMessages = false) {
  await win.waitForTimeout(700)
  if (clearMessages) {
    await win.locator('.ant-message').evaluateAll((nodes) => nodes.forEach((node) => node.remove()))
  }
}

async function main() {
  mkdirSync(outputDir, { recursive: true })
  const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-screenshot-udd-'))
  const libraryRoot = mkdtempSync(join(tmpdir(), 'wxk-screenshot-lib-'))
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    libraryRoot,
    defaultFormats: ['cover', 'md', 'html', 'meta'],
    downloadVideos: false,
    cliLinkPrompted: true,
    updateCheckEnabled: false,
  }))

  log('article', articleUrl)
  log('output', outputDir)

  // 无头/受限会话（agent 沙箱、CI）GPU 与 Chromium 沙箱起不来——WXKIT_E2E_HEADLESS=1 时禁用
  const headlessFlags = process.env.WXKIT_E2E_HEADLESS ? ['--disable-gpu', '--no-sandbox'] : []
  // ELECTRON_RUN_AS_NODE 会让 Electron 以纯 Node 模式启动，打不出调试端口行
  // （宿主为 Electron 的环境如 WorkBuddy 会注入该变量）。与 gui.e2e.mjs 同款摘除。
  const cleanEnv = { ...process.env }
  delete cleanEnv.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot, `--user-data-dir=${userDataDir}`, ...headlessFlags],
    cwd: projectRoot,
    env: { ...cleanEnv },
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`))
  win.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })

  try {
    await app.evaluate(({ BrowserWindow }) => {
      const current = BrowserWindow.getAllWindows()[0]
      current.setSize(1280, 860)
      current.center()
    })
    await win.waitForSelector('[data-testid="app-shell"]', { timeout: 20_000 })
    await win.fill('[data-testid="url-input"]', articleUrl)
    await win.click('[data-testid="start-download"]')

    const event = win.locator('[data-testid="history-event"]').first()
    await event.waitFor({ state: 'visible', timeout: 180_000 })
    await event.locator('[data-testid="history-article"]').first().waitFor({ state: 'visible', timeout: 20_000 })
    const eventText = await event.innerText()
    assert(eventText.includes('1 成功') && !eventText.includes('失败：'), '真实文章下载成功')
    await win.screenshot({ path: join(outputDir, 'download.png') })

    await win.click('[data-testid="nav-文库"]')
    await win.waitForSelector('.ghead', { timeout: 20_000 })
    await win.locator('.ghead').first().click()
    const card = win.locator('[data-testid="article-card"]').first()
    await card.waitFor({ state: 'visible', timeout: 10_000 })
    await settleUi(win, true)
    await win.screenshot({ path: join(outputDir, 'library.png') })

    await card.locator('[data-testid="card-read"]').click()
    await win.waitForSelector('.reader-title', { timeout: 20_000 })
    await win.waitForSelector('.prose', { timeout: 20_000 })
    assert((await win.locator('.prose').innerText()).trim().length > 20, '阅读器呈现真实正文')
    await settleUi(win, true)
    await win.screenshot({ path: join(outputDir, 'reader.png') })

    await win.click('[data-testid="nav-设置"]')
    await win.waitForSelector('[data-testid="settings-category-nav"]', { timeout: 10_000 })
    // M71 信息架构：设置按分类挂载，元素须先进入对应分类才存在
    await win.click('[data-testid="settings-cat-content"]')
    await win.waitForSelector('[data-testid="set-download-videos"]', { timeout: 10_000 })
    await win.click('[data-testid="settings-cat-accounts"]')
    await win.waitForSelector('[data-testid="mp-account"]', { timeout: 10_000 })
    assert((await win.locator('[data-testid="mp-account"]').count()) === 1, '设置页含微信读书账号入口')
    await win.click('[data-testid="settings-cat-automation"]')
    await win.waitForSelector('[data-testid="set-subs-auto"]', { timeout: 10_000 })
    assert((await win.locator('[data-testid="set-subs-auto"]').count()) === 1, '设置页含订阅配置')
    await win.click('[data-testid="settings-cat-content"]')
    await win.waitForSelector('[data-testid="set-download-videos"]', { timeout: 10_000 })
    await settleUi(win, true)
    await win.screenshot({ path: join(outputDir, 'settings.png') })

    // v0.12.0：选题页是当前有效页面——截「输入素材 + 选稿弹层」形态（未配置模型，
    // 不发真实请求；弹层列表来自刚入库的真实文章）。
    await win.click('[data-testid="nav-选题"]')
    await win.waitForSelector('[data-testid="topics-page"]', { timeout: 20_000 })
    await win.click('[data-testid="topic-manual-pick"]')
    await win.waitForSelector('[data-testid="topic-manual-list"]', { timeout: 20_000 })
    await win.locator('[data-testid="topic-manual-time"] .ant-segmented-item:has-text("全部")').click()
    await win.waitForSelector('[data-testid="topic-manual-list"] .topic-manual-row', { timeout: 20_000 })
    await win.locator('[data-testid="topic-manual-list"] .topic-manual-row').first().click()
    await settleUi(win, true)
    await win.screenshot({ path: join(outputDir, 'topics.png') })
    await win.click('[data-testid="topic-manual-confirm"]')
    await win.waitForSelector('[data-testid="topic-manual-count"]', { timeout: 10_000 })
    await settleUi(win, true)
    await win.screenshot({ path: join(outputDir, 'topics-picked.png') })

    const library = JSON.parse(readFileSync(join(libraryRoot, 'library.json'), 'utf8'))
    assert(library.articles?.length === 1, '截图使用真实入库文章')
    const auditPath = join(userDataDir, 'mp-request-audit.log')
    const audit = existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : ''
    assert(!audit.includes('/cgi-bin/'), '截图流程未访问私有后台接口')
    assert(errors.length === 0, `页面与控制台无错误（${errors.length}）`)
  } finally {
    await app.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(libraryRoot, { recursive: true, force: true })
  }

  log('ALL PASSED')
}

main().catch((error) => {
  console.error('[screenshots] FAILED:', error)
  process.exit(1)
})
