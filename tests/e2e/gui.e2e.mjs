// End-to-end GUI test for wx-kit, driving the real Electron app via Playwright.
// Covers v0.10.0 feature points:
//   M5 IA (按链接下载 / 按公众号下载 / 文库 / 设置导航)
//   M6 下载闭环 + 历史 (就地阅读/文件夹 · 复制下载项 · 已存在跳过 · 失败重试)
//   M9 文库组织 (排序 · 筛选 · 分组 · 卡片⇄列表 · 单击选中/双击阅读 · 批量删除)
//   + 阅读器 wxfile:// 图片/iframe · 设置库根
//   + v0.10.0：订阅(Subscriptions) / 微信读书登录入口；按公众号下载入口已停用（断言不存在）
//
// 微信读书后端在 e2e 里用本地 mock 顶替：
//   - WXKIT_WEREAD_BASE 把 /api/mp/cover 指到本机 fixture server（只返回最新一篇）
//   - 文章页 fetch 走 persist:mpweixin 会话，用 webRequest 把 mp.weixin.qq.com/s/SUBTOKEN
//     重定向回 fixture，使「取最新一篇 → 抓正文」整条链路封闭、不碰真实网络。
//
// Run: npx vite build && node tests/e2e/gui.e2e.mjs   (or: npm run test:e2e)
import { _electron as electron } from 'playwright'
import http from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
// biz/mid/idx 注入脚本变量，使「短链无 hint 时补主键判重」与「粘贴链接识别公众号」可测。
const ARTICLES = {
  a1: { title: '阿尔法·甲', account: '甲号', pub: '2026-03-01 08:00', biz: 'MzYzNDg1MDcyNQ==', mid: '2247486019', idx: '1' },
  a2: { title: '贝塔·甲', account: '甲号', pub: '2026-03-05 09:00', biz: 'MzYzNDg1MDcyNQ==', mid: '2247486020', idx: '1' },
  // 每个公众号必须有独立 biz（= 下载后 meta 的 accountId 身份）：M57 R2 起下拉按身份归并，
  // 共用 biz 的两个名称会被并成同一选项（等价于「同号改名」）——fixture 必须反映真实形态。
  a3: { title: '伽马·乙', account: '乙号', pub: '2026-02-10 10:00', biz: 'OTk5ODg4Nzc3', mid: '2247486021', idx: '1' },
  suba1: { title: '百宝箱订阅验收文', account: '测试订阅号', pub: '2026-08-27 10:00', biz: 'ODg4Nzc3NjY2', mid: '2247486999', idx: '1' },
  bad: { title: '', account: '', pub: '' },   // 无标题 → 解析失败 → 失败项
}
const WEREAD_BOOK_ID = 'MP_WXS_3634850725'   // = normalizeAccountId(biz MzYzNDg1MDpyNQ==)
const WEREAD_TOKEN = 'SUBTOKEN'              // reviewId 末段 → 文章短链 token
// 「识别公众号」与订阅都要求 mp.weixin.qq.com 链接（后端有正则校验），故用此假链接，
// 再靠 persist:mpweixin 会话上的 webRequest 重定向回 fixture 封闭链路。
const MP_ARTICLE_URL = `https://mp.weixin.qq.com/s/${WEREAD_TOKEN}`

function makeHtml(port, art) {
  const titleTag = art.title ? `<h1 class="rich_media_title" id="activity-name">${art.title}</h1>` : ''
  const vars = (art.biz || art.mid || art.idx)
    ? `<script>var biz="${art.biz ?? ''}";var mid="${art.mid ?? ''}";var idx="${art.idx ?? ''}";</script>` : ''
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
</div>
${vars}
</body></html>`
}

const log = (...a) => console.log('[e2e]', ...a)
let failed = false
const assert = (cond, msg) => { if (cond) { log('✓', msg) } else { failed = true; console.error('[e2e] ✗', msg) } }

async function main() {
  // --- fixture server ---
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    if (u.pathname.startsWith('/article/')) {
      const art = ARTICLES[u.pathname.slice('/article/'.length)] ?? ARTICLES.a1
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(makeHtml(server.address().port, art))
    } else if (u.pathname === '/api/mp/cover') {
      // Plan B: 每次只返回该号最新一篇
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({
        errCode: 0,
        reviewId: `${WEREAD_BOOK_ID}_${WEREAD_TOKEN}`,
        title: '订阅号最新文',
        name: '测试订阅号',
        pic: `http://127.0.0.1:${server.address().port}/cover.png`,
        avatar: `http://127.0.0.1:${server.address().port}/cover.png`,
      }))
    } else if (u.pathname === '/pic.png' || u.pathname === '/cover.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG)
    } else { res.writeHead(404); res.end('no') }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const urlOf = (id) => `http://127.0.0.1:${port}/article/${id}`
  const wereadBase = `http://127.0.0.1:${port}`
  log('fixture server on', port)

  // --- isolated userData + library root, seed settings + weread creds ---
  const userDataDir = mkdtempSync(join(tmpdir(), 'wxk-e2e-udd-'))
  const libraryRoot = mkdtempSync(join(tmpdir(), 'wxk-e2e-lib-'))
  writeFileSync(join(userDataDir, 'settings.json'),
    JSON.stringify({
      libraryRoot,
      defaultFormats: ['cover', 'md', 'html', 'meta'],
      cliLinkPrompted: true,
      updateCheckEnabled: false,
    }))
  // 预置微信读书 Web 凭据（vid + refreshToken 当 wr_skey），使订阅/批量下载链路无需真实扫码即可走到网络请求（被 mock 接住）
  writeFileSync(join(userDataDir, 'weread-creds.json'),
    JSON.stringify({ vid: '17207435', accessToken: 'SHORT8', refreshToken: 'web@fake-e2e-token-long-value-for-wr_skey', name: 'e2e', updatedAt: Date.now() }))
  log('libraryRoot', libraryRoot)

  const app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
    env: { ...process.env, WXKIT_WEREAD_BASE: wereadBase },
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  win.on('crash', () => errors.push('PAGE CRASHED'))
  const proc = app.process()
  proc.stderr?.on('data', (d) => {
    const s = String(d)
    if (!s.includes('IMKCFRunLoop')) process.stderr.write('[main] ' + s)
  })

  // 把订阅链路里「取最新一篇 → 抓正文」的 mp.weixin.qq.com/s/SUBTOKEN 重定向回 fixture，
  // 使整条链路封闭（文章正文本地可取，不碰真实微信）。
  await app.evaluate(({ session }, p) => {
    const ses = session.fromPartition('persist:mpweixin')
    ses.webRequest.onBeforeRequest((details, callback) => {
      try {
        const u = new URL(details.url)
        if (u.hostname === 'mp.weixin.qq.com' && u.pathname === `/s/${p.token}`) {
          return callback({ redirectURL: `http://127.0.0.1:${p.port}/article/suba1` })
        }
      } catch { /* ignore */ }
      callback({})
    })
  }, { port, token: WEREAD_TOKEN })

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
    // 2026-08-28：按公众号批量下载入口已停用（列表接口服务端封禁），订阅保留
    assert((await win.locator('[data-testid="mode-account"]').count()) === 0, 'account download mode is absent (retired)')
    assert((await win.locator('[data-testid="nav-订阅"]').count()) === 1, 'subscriptions navigation is present')

    // ============ M6 · URL 批量下载 → 历史就地确认 ============
    await win.click('[data-testid="nav-下载"]')
    await win.waitForSelector('[data-testid="start-download"]', { timeout: 5000 })
    // M61:下载页双模式（链接 / 墨问笔记）——默认链接模式原样；墨问 tab 切过去渲染搜索骨架
    assert((await win.locator('[data-testid="download-mode-segmented"]').count()) === 1, 'M61: download mode segmented present')
    await win.locator('.ant-segmented-item:has-text("墨问笔记")').click()
    await win.waitForSelector('[data-testid="mowen-mode"]', { timeout: 5000 })
    assert((await win.locator('[data-testid="mowen-search-input"]').count()) === 1, 'M61: mowen tab shows user search input')
    // e2e 隔离环境 PATH 里 mocli 可达与否不定——指引条或正常搜索框二选一,不允许空白页
    const tabMissing = (await win.locator('[data-testid="mowen-tab-missing"]').count()) === 1
    assert(tabMissing || (await win.locator('[data-testid="mowen-tab-error"]').count()) === 0,
      'M61: mowen tab renders either the mocli-missing guide or a clean search state')
    await win.locator('.ant-segmented-item:has-text("按链接下载")').click()
    await win.waitForSelector('[data-testid="start-download"]', { timeout: 5000 })
    await win.fill('[data-testid="url-input"]', [urlOf('a1'), urlOf('a2'), urlOf('a3')].join('\n'))
    await win.click('[data-testid="start-download"]')
    await win.waitForSelector('[data-testid="history-event"]', { timeout: 30000 })
    await win.waitForSelector('[data-testid="history-article"]', { timeout: 10000 })
    const topEvent = () => win.locator('[data-testid="history-event"]').first()
    const artCount = await topEvent().locator('[data-testid="history-article"]').count()
    assert(artCount === 3, `url batch landed 3 articles in one history event (got ${artCount})`)
    assert(await topEvent().locator('[data-testid="history-read"]').first().isVisible(), 'history article offers in-place 阅读')
    assert((await topEvent().locator('button:has-text("文件夹")').count()) >= 3, 'history articles offer 文件夹')

    await topEvent().locator('.ev-again').click()
    await win.waitForTimeout(200)
    const refilled = await win.inputValue('textarea')
    assert(refilled.includes(urlOf('a1')) && refilled.includes(urlOf('a3')), '复制下载项 refills the URL textarea')

    await win.click('[data-testid="start-download"]')
    await win.waitForSelector('[data-testid="history-event"] .badge-skip', { timeout: 20000 })
    assert(true, 're-download marks existing articles 已存在 (skipped)')

    await win.fill('[data-testid="url-input"]', urlOf('bad'))
    await win.click('[data-testid="start-download"]')
    await win.waitForSelector('[data-testid="history-event"] .fail-reason', { timeout: 20000 })
    assert(await topEvent().locator('.fail-reason').first().isVisible(), 'failed download shows a reason in history')
    assert((await topEvent().locator('button.retry, .retry').count()) >= 1, 'failed history item offers 重试')

    // ============ M5 · 设置（库根 + 微信读书 + 保护 + 订阅）============
    await win.click('[data-testid="nav-设置"]')
    await win.waitForSelector('input[readonly]', { timeout: 10000 })
    assert((await win.inputValue('input[readonly]')) === libraryRoot, 'settings shows the seeded library root')
    assert((await win.locator('[data-testid="mp-account"]').count()) === 1, 'v0.10.0: WeRead account section is present')
    const mpStatus = await win.locator('[data-testid="set-mp-status"]').innerText()
    assert(mpStatus.includes('已登录'), `v0.10.0: seeded WeRead creds reported as logged in (saw "${mpStatus}")`)
    assert((await win.locator('[data-testid="set-mp-logout"]').count()) === 1, 'v0.10.0: logout action is present')
    assert((await win.locator('[data-testid="mp-protection"]').count()) === 1, 'v0.10.0: request-protection settings are present')
    assert((await win.locator('[data-testid="set-subs-auto"]').count()) === 1, 'v0.10.0: subscription settings are present')
    assert((await win.locator('[data-testid="about-check-update"]').count()) === 1, 'settings keeps the check-update action')
    assert((await win.locator('[data-testid="set-update-check"]').count()) === 1, 'settings keeps the startup-check toggle')
    assert((await win.locator('[data-testid="site-sync-help"]').count()) === 1, 'settings keeps site-sync help')

    // ============ M60 · 设置页墨问集成区块（读缓存渲染，两种状态取其一）============
    await win.waitForSelector('[data-testid="mowen-section"]', { timeout: 8000 })
    // 启动检测是 fire-and-forget，等它的 settings 写入落地后再断言（检测到/未检测到都算通过，形态必须二选一）
    await win.waitForTimeout(1500)
    const installed = (await win.locator('[data-testid="mowen-status-installed"]').count()) === 1
    const missing = (await win.locator('[data-testid="mowen-status-missing"]').count()) === 1
    assert(installed !== missing && (installed || missing),
      `M60: mowen section shows exactly one state (installed=${installed}, missing=${missing})`)
    assert((await win.locator('[data-testid="mowen-redetect"]').count()) === 1, 'M60: re-detect button is present')

    // ============ M9/M23 · 文库组织(a1/a2/a3) ============
    await win.click('[data-testid="nav-文库"]')
    await win.waitForSelector('.ghead', { timeout: 15000 })
    assert((await win.locator('[data-testid="article-card"]').count()) === 0,
      'M23: groups are collapsed by default (library opens as an account directory)')
    const heads = await win.locator('.ghead .gname').allInnerTexts()
    assert(heads.includes('甲号') && heads.includes('乙号'), `card view grouped by account (${heads.join('/')})`)
    await win.locator('.ghead:has-text("甲号")').click()
    await win.waitForTimeout(250)
    const afterOne = await win.locator('[data-testid="article-card"]').count()
    assert(afterOne === 2, `M23: clicking a group head expands just that group (got ${afterOne})`)
    await win.click('[data-testid="expand-all"]')
    await win.waitForTimeout(250)
    const libCount = await win.locator('[data-testid="article-card"]').count()
    assert(libCount === 3, `expand-all shows the 3 successfully-downloaded articles (got ${libCount})`)

    await win.click('[data-testid="group-toggle"]')
    await win.waitForTimeout(200)
    assert((await firstCardText()).includes('贝塔'), 'M25: default sort is publish-time desc (newest first, no manual pick)')
    await win.click('[data-testid="sort-dir"]')
    await win.waitForTimeout(200)
    assert((await firstCardText()).includes('伽马'), 'sort by publish-time asc puts the oldest article first')
    await win.click('[data-testid="nav-设置"]')
    await win.click('[data-testid="nav-文库"]')
    await win.waitForSelector('[data-testid="article-card"]', { timeout: 10000 })
    await win.click('[data-testid="group-toggle"]')
    await win.waitForTimeout(200)
    assert((await firstCardText()).includes('伽马'), 'M25: sort choice persists across navigation (still asc)')
    await win.click('[data-testid="sort-dir"]')
    await win.waitForTimeout(200)
    assert((await firstCardText()).includes('贝塔'), 'flipping direction puts the newest article first')

    await pickSelect('account-select', '甲号')
    await win.waitForTimeout(200)
    const filtered = await win.locator('[data-testid="article-card"]').count()
    const hasGamma = (await win.locator('[data-testid="article-card"]').allInnerTexts()).some((t) => t.includes('伽马'))
    assert(filtered === 2 && !hasGamma, `filter by account narrows to that account (got ${filtered}, gamma=${hasGamma})`)
    await pickSelect('account-select', '全部公众号')

    await win.click('.ant-segmented label:has-text("列表")')
    await win.waitForSelector('[data-testid="article-row"]', { timeout: 8000 })
    assert(true, 'card⇄list view toggle works (Finder-like rows)')
    const firstRowText = async () => (await win.locator('[data-testid="article-row"] .ltitle').first().textContent()) || ''
    await win.click('.lhead .lh-sort:has-text("标题")')
    await win.waitForTimeout(150)
    await win.click('.lhead .lh-sort:has-text("发布时间")')
    await win.waitForTimeout(150)
    assert((await firstRowText()).includes('贝塔'), 'list header sort by publish desc puts newest (贝塔) first')
    await win.click('.lhead .lh-sort:has-text("发布时间")')
    await win.waitForTimeout(150)
    assert((await firstRowText()).includes('伽马'), 'clicking same header flips to asc (oldest 伽马 first)')

    // ============ M59 · 复制路径（列表常驻按钮 + 卡片右键菜单）============
    const readClipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
    await win.locator('[data-testid="row-copy-path"]').first().click()
    const clipList = await readClipboard()
    assert(clipList.startsWith(libraryRoot), `M59: list row copy-path puts the abs dir on clipboard (got ${clipList})`)
    await win.waitForSelector('.ant-message :text("已复制")', { timeout: 3000 })
    assert(true, 'M59: copy-path shows 已复制 toast')

    // 卡片视图右键菜单：四项齐全、作用于右键所在篇、不被选中集劫持
    // antd 菜单关闭有离场动画,动画结束才加 .ant-dropdown-hidden;每次点完菜单项
    // 必须等它彻底收起,否则下一次右键时新旧两个菜单同时可见,定位歧义
    const visibleMenuItem = (text) => win.locator(`.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item:has-text("${text}")`)
    const waitAllMenusClosed = () => win.waitForFunction(
      () => [...document.querySelectorAll('.ant-dropdown')].every((d) => d.classList.contains('ant-dropdown-hidden')),
      undefined, { timeout: 3000 },
    )
    await win.click('.ant-segmented label:has-text("卡片")')
    await win.waitForSelector('[data-testid="article-card"]', { timeout: 8000 })
    await win.locator('[data-testid="article-card"]').nth(0).click({ button: 'right' })
    await win.waitForSelector('.ant-dropdown-menu-item', { timeout: 5000 })
    const menuLabels = await win.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').allInnerTexts()
    assert(['阅读', '文件夹', '复制路径', '删除'].every((t) => menuLabels.some((l) => l.includes(t))),
      `M59: card context menu offers 阅读/文件夹/复制路径/删除 (got ${menuLabels.join('/')})`)
    await visibleMenuItem('复制路径').click()
    await waitAllMenusClosed()
    const clipCard0 = await readClipboard()
    assert(clipCard0.startsWith(libraryRoot), 'M59: card context copy-path puts the abs dir on clipboard')
    await win.locator('[data-testid="article-card"]').nth(1).click({ button: 'right' })
    await visibleMenuItem('复制路径').click()
    await waitAllMenusClosed()
    const clipCard1 = await readClipboard()
    assert(clipCard1 !== clipCard0 && clipCard1.startsWith(libraryRoot),
      'M59: copy-path binds to the right-clicked card, not a fixed entry')
    // 选中两篇后再右键第一篇复制 → 仍是第一篇路径（不与 sel 耦合）
    await win.locator('[data-testid="article-card"]').nth(0).click()
    await win.locator('[data-testid="article-card"]').nth(1).click()
    await win.locator('[data-testid="article-card"]').nth(0).click({ button: 'right' })
    await visibleMenuItem('复制路径').click()
    await waitAllMenusClosed()
    assert((await readClipboard()) === clipCard0,
      'M59: multi-select does not hijack copy-path (still the right-clicked card)')
    await win.locator('[data-testid="article-card"]').nth(0).click()
    await win.locator('[data-testid="article-card"]').nth(1).click()   // 撤掉选中,别影响后续批量删除断言
    // 右键菜单是发现性补充：hover 入口仍在
    await win.locator('[data-testid="article-card"]').first().hover()
    assert((await win.locator('[data-testid="card-read"]').count()) > 0
      && (await win.locator('[data-testid="card-delete"]').count()) > 0,
      'M59: hover actions remain alongside the context menu')
    await win.click('.ant-segmented label:has-text("列表")')
    await win.waitForSelector('[data-testid="article-row"]', { timeout: 8000 })

    const colsBefore = await win.locator('.list').evaluate((el) => getComputedStyle(el).getPropertyValue('--lcols'))
    const rzBox = await win.locator('.lhead .lh-resz:has-text("发布时间") .rz').boundingBox()
    await win.mouse.move(rzBox.x + 3, rzBox.y + rzBox.height / 2)
    await win.mouse.down()
    await win.mouse.move(rzBox.x + 60, rzBox.y + rzBox.height / 2, { steps: 6 })
    await win.mouse.up()
    await win.waitForTimeout(150)
    const colsAfter = await win.locator('.list').evaluate((el) => getComputedStyle(el).getPropertyValue('--lcols'))
    assert(colsBefore !== colsAfter, 'dragging a column handle resizes the column (--lcols changed)')

    await win.locator('[data-testid="article-row"]:has-text("阿尔法")').first().dblclick()
    await win.waitForSelector('img[src^="wxfile://"]', { timeout: 15000 })
    const mdImgOk = await win.evaluate(() => {
      const im = [...document.querySelectorAll('img')].find((i) => i.src.startsWith('wxfile://'))
      return !!im && im.complete && im.naturalWidth > 0
    })
    assert(mdImgOk, 'double-click row opens reader; md wxfile image actually rendered (naturalWidth>0)')
    await win.click('.ant-segmented >> text=网页')
    await win.waitForSelector('iframe', { timeout: 10000 })
    const iframeSrc = await win.getAttribute('iframe', 'src')
    assert(!!iframeSrc && iframeSrc.startsWith('wxfile://') && iframeSrc.endsWith('/index.html'),
      'reader html view: iframe src is wxfile .../index.html')
    // 外链修复（阅读器原文链接 ERR_BLOCKED_BY_RESPONSE）：协议层注入 base + iframe 允许弹窗,
    // 让「原文」走新窗口 → 主窗口 setWindowOpenHandler → 系统浏览器（真开浏览器不入 e2e,行为人工验）
    const iframeSandbox = await win.getAttribute('iframe', 'sandbox')
    assert(iframeSandbox.includes('allow-popups'), 'reader iframe sandbox allows popups (external links)')
    // 主进程 net.fetch 走 wxfile 协议栈（主窗口的 renderer fetch 会被 CORS 拦）
    const servedHtml = await app.evaluate(async ({ net }, u) => await (await net.fetch(u)).text(), iframeSrc)
    assert(servedHtml.includes('<base target="_blank">'),
      'wxfile-served html injects <base target="_blank"> (external links open via system browser)')

    // ============ M9 · 批量删除 + 单篇删除(a1/a2/a3) → 文库清空 ============
    await win.click('[data-testid="nav-文库"]')
    await win.waitForSelector('[data-testid="article-card"]', { timeout: 10000 })
    await win.locator('[data-testid="article-card"]').nth(0).click()
    await win.locator('[data-testid="article-card"]').nth(1).click()
    await win.waitForSelector('[data-testid="batch-delete"]', { timeout: 5000 })
    assert(true, 'single-click selects cards and reveals the batch bar')
    await win.click('[data-testid="batch-delete"]')
    await win.click('.ant-popover button:has-text("删")')
    await win.waitForTimeout(800)
    const afterBatch = await win.locator('[data-testid="article-card"]').count()
    assert(afterBatch === 1, `batch delete removed 2, 1 remains (got ${afterBatch})`)
    await win.locator('[data-testid="article-card"]').first().hover()
    await win.click('[data-testid="card-delete"]')
    await win.click('.ant-popover button:has-text("删")')
    await win.waitForSelector('[data-testid="article-card"]', { state: 'detached', timeout: 10000 })
    assert(true, 'single delete removed the last card (library empty)')

    // ============ v0.10.0 · 订阅：粘贴文章链接识别公众号 → 添加 ============
    await win.click('[data-testid="nav-订阅"]')
    await win.waitForSelector('[data-testid="subs-search-input"]', { timeout: 5000 })
    // R3: 空输入点「识别」→ 引导话术，不发请求（mock 不变即可断言）
    await win.click('[data-testid="subs-search-btn"]')
    await win.waitForSelector('.ant-message-notice:has-text("先粘贴")', { timeout: 3000 })
    assert(true, 'M57: 空输入识别给出引导话术')
    await win.fill('[data-testid="subs-search-input"]', MP_ARTICLE_URL)
    await win.click('[data-testid="subs-search-btn"]')
    await win.waitForSelector('.ant-list-item:has-text("测试订阅号")', { timeout: 10000 })
    assert(true, '粘贴文章链接识别出公众号「测试订阅号」')
    await win.locator('.ant-list-item:has-text("测试订阅号") a:has-text("订阅")').click()
    await win.waitForSelector('[data-testid="subs-row"]', { timeout: 10000 })
    assert((await win.locator('[data-testid="subs-row"]').count()) === 1, '订阅后列表出现 1 个账号')

    // ============ 2026-08-28 · 订阅行内能力：删除标记 + 行内检查状态隔离 ============
    await win.locator('[data-testid="subs-row"]').first().hover()
    await win.locator('[data-testid="subs-remove"]').first().click()
    await win.locator('.ant-popover button:has-text("删")').click()
    await win.waitForTimeout(600)
    assert((await win.locator('[data-testid="subs-row"]').count()) === 0, '删除订阅后行消失')
    // 重新订阅回来（验证删除标记可被再订阅撤销），供下一阶段检查
    await win.fill('[data-testid="subs-search-input"]', MP_ARTICLE_URL)
    await win.click('[data-testid="subs-search-btn"]')
    await win.waitForSelector('.ant-list-item:has-text("测试订阅号")', { timeout: 10000 })
    await win.locator('.ant-list-item:has-text("测试订阅号") a:has-text("订阅")').click()
    await win.waitForSelector('[data-testid="subs-row"]', { timeout: 10000 })
    assert(true, '删除后重新订阅成功（删除标记被撤销）')
    await win.locator('[data-testid="subs-check-one"]').first().click()
    // M58 起行内检查的结果由落盘明细派生（提示策略也有明细）——显示摘要「待下载」而非瞬时结果态
    await win.waitForSelector('[data-testid="subs-row-summary"]', { timeout: 30000 })
    const inlineSum = await win.locator('[data-testid="subs-row-summary"]').first().innerText()
    assert(inlineSum.includes('待下载') && inlineSum.includes('发现'),
      `行内「检查」只影响本行并落结果，摘要显示待下载 (saw: ${inlineSum.slice(0, 40)})`)

    // ============ M56 · 落盘下载明细：行内摘要 + 明细弹窗 + 常驻文库入口 ============
    // seed 一条含 downloadDetail 的检查记录（模拟定时自动下载已发生），再进订阅页断言可感知
    {
      const subPath = join(libraryRoot, 'subscriptions.json')
      const sub = JSON.parse(readFileSync(subPath, 'utf8'))
      const acc = sub.accounts.find((a) => a.subscribed)
      assert(!!acc, 'seed 前订阅文件里存在已订阅账号')
      sub.checkLog = [{
        time: Date.now(), trigger: 'auto', kind: 'check', accounts: 1,
        newFound: 1, failed: 0, downloaded: 1, existed: 0,
        downloadDetail: [{ fakeid: acc.fakeid, nickname: acc.nickname,
          items: [{ title: '订阅号最新文', status: 'downloaded' }] }],
      }, ...(sub.checkLog ?? [])]
      writeFileSync(subPath, JSON.stringify(sub))
    }
    await win.click('[data-testid="nav-设置"]')
    await win.click('[data-testid="nav-订阅"]')
    await win.waitForSelector('[data-testid="subs-row-summary"]', { timeout: 8000 })
    const summary = await win.locator('[data-testid="subs-row-summary"]').first().innerText()
    assert(summary.includes('已下载 1 篇') && summary.includes('自动'),
      `M56: 行内摘要来自落盘明细且标注触发方式 (saw: ${summary.slice(0, 40)})`)
    // 明细弹窗：点开检查记录，断言逐篇明细（标题 + 状态）
    await win.locator('[data-testid="subs-log-entry"]').first().click()
    await win.waitForSelector('.ant-modal-confirm', { timeout: 5000 })
    const dlg = await win.locator('.ant-modal-confirm').innerText()
    assert(dlg.includes('下载明细') && dlg.includes('订阅号最新文') && dlg.includes('已下载'),
      `M56: 明细弹窗分节展示逐篇状态 (saw: ${dlg.slice(0, 60).replace(/\n/g, ' ')})`)
    await win.click('.ant-modal-confirm .ant-btn:has-text("知道了")')
    await win.waitForSelector('.ant-modal-confirm', { state: 'detached', timeout: 5000 })
    // 常驻文库入口：点击 → 文库按该号筛选；该号无文章 → 专属空态（一石二鸟验入口与空态）
    await win.locator('[data-testid="subs-goto-library"]').first().click()
    await win.waitForSelector('[data-testid="library-account-empty"]', { timeout: 8000 })
    const emptyText = await win.locator('[data-testid="library-account-empty"]').innerText()
    assert(emptyText.includes('还没有已下载的文章'),
      `M56: 文库入口按身份筛选且空态有专属提示 (saw: ${emptyText.slice(0, 40)})`)
    // R2: 跳转文库后筛选框显示公众号名称而非裸 ID（该号 0 篇的空态场景，名称来自跳转参数）。
    // Antd v6 单选的选中 label 是 .ant-select-content 里的裸文本节点（-content-value 仅在
    // option 自带样式时出现），断言取容器文本。
    const selText = (await win.locator('[data-testid="account-select"] .ant-select-content').innerText()).trim()
    assert(selText === '测试订阅号', `M57: 跳转文库后筛选框显示名称(实际:${selText})`)
    await win.click('[data-testid="library-clear-account"]')
    await win.waitForSelector('[data-testid="library-account-empty"]', { state: 'detached', timeout: 5000 })
    assert(true, 'M56: 清除筛选后该号专属空态消失')
    // 此时文库已被 M9 段清空：清除筛选回落到的是「文库还是空的」全局空态——两种空态话术正确区分
    const globalEmpty = await win.locator('.empty-state').last().innerText()
    assert(globalEmpty.includes('文库还是空的'),
      `M56: 清除筛选后回落全局空态（与该号空态话术区分）(saw: ${globalEmpty.slice(0, 30).replace(/\n/g, ' ')})`)

    // ============ M56 · 手动「下载全部待处理」→ kind:'download' 落盘（ipc subscriptions:downloadAllNew 全链路）============
    // 此前行内「检查」在仅提示策略（settings 默认）下已投递 1 篇 pending（cover mock 给的短链，
    // mp.weixin.qq.com/s/SUBTOKEN 已被 webRequest 重定向回 fixture，可真实下载成功）。
    // 这里点真实按钮走完主进程 downloadAllNew，再直接读 subscriptions.json 核对补下载记录。
    await win.click('[data-testid="nav-订阅"]')
    await win.waitForSelector('[data-testid="subs-download-all"]', { timeout: 8000 })
    await win.click('[data-testid="subs-download-all"]')
    // 下载完成 + emitSubsUpdated → load() 重取后 pending 清空，按钮（pendingTotal>0 才渲染）随之卸载
    await win.waitForSelector('[data-testid="subs-download-all"]', { state: 'detached', timeout: 30000 })
    {
      const sub2 = JSON.parse(readFileSync(join(libraryRoot, 'subscriptions.json'), 'utf8'))
      const last = sub2.checkLog?.[0]
      assert(last?.kind === 'download' && last?.trigger === 'manual' && last?.newFound === 0,
        `M56: 下载全部待处理落 kind=download / trigger=manual / newFound=0 记录` +
        ` (kind=${last?.kind}, trigger=${last?.trigger}, newFound=${last?.newFound})`)
      const detail = (last?.downloadDetail ?? []).find((d) => d.nickname === '测试订阅号')
      // 状态不锁死（downloaded/exists 均算落盘成立），但逐篇明细必须非空
      assert(!!detail && detail.items.length > 0,
        `M56: 补下载记录 downloadDetail 含「测试订阅号」且逐篇明细非空 (items=${detail?.items?.length ?? 0})`)
    }
    // 行内摘要随最新补下载记录更新：纯交付话术、不出现「发现」（补下载 newFound=0，说了就与检查记录的「新 0」打架）
    const sumAfterDl = await win.locator('[data-testid="subs-row-summary"]').first().innerText()
    assert(sumAfterDl.includes('补下载') && !sumAfterDl.includes('发现'),
      `M56: 补下载后行内摘要为纯交付话术，无「发现」(saw: ${sumAfterDl.slice(0, 40)})`)

    // ============ M58 · 行内「本轮检查文章列表」：pending 明细 + 单篇下载 + 直开阅读器 ============
    // seed 一条含 pending 明细的检查记录 + 同一篇文章的 newRefs（url 指向 fixture，可真实下载）。
    // refId 退化为 sourceUrlKey(url)（ArticleRef 无 mid/idx 时），与 UI 的 downloadable 判定同源。
    {
      const artUrl = urlOf('a1')
      const sub3 = JSON.parse(readFileSync(join(libraryRoot, 'subscriptions.json'), 'utf8'))
      const acc = sub3.accounts.find((x) => x.nickname === '测试订阅号')
      acc.newRefs = [{ url: artUrl, title: '阿尔法·甲', createTime: Math.floor(Date.now() / 1000), sourceId: 'm58-seed' }]
      sub3.checkLog = [{
        time: Date.now(), trigger: 'manual', accounts: 1, newFound: 1, failed: 0,
        downloadDetail: [{ fakeid: acc.fakeid, nickname: acc.nickname,
          items: [{ title: '阿尔法·甲', status: 'pending', url: artUrl, refId: artUrl }] }],
      }, ...(sub3.checkLog ?? [])]
      writeFileSync(join(libraryRoot, 'subscriptions.json'), JSON.stringify(sub3))
    }
    await win.click('[data-testid="nav-设置"]')
    await win.click('[data-testid="nav-订阅"]')
    await win.waitForSelector('[data-testid="subs-row"]', { timeout: 8000 })
    await win.locator('[data-testid="subs-expand"]').first().click()
    await win.waitForSelector('[data-testid="subs-pending-item"]', { timeout: 8000 })
    const st0 = await win.locator('[data-testid="subs-item-status"]').first().innerText()
    assert(st0 === '未下载', `M58: 检查明细显示 pending 状态 (saw: ${st0})`)
    // 单篇下载 → 走真实下载链路（fixture a1）→ 检查明细回填 → 状态就地变为结果态
    await win.locator('[data-testid="subs-item-download"]').first().click()
    await win.waitForFunction(() => {
      const el = document.querySelector('[data-testid="subs-item-status"]')
      return el && el.textContent !== '未下载'
    }, { timeout: 30000 })
    const st1 = await win.locator('[data-testid="subs-item-status"]').first().innerText()
    assert(st1 === '已下载' || st1 === '文库已有', `M58: 单篇下载后状态就地更新 (saw: ${st1})`)
    // articleId 回填后点标题直开阅读器
    await win.locator('[data-testid="subs-pending-title"]').first().click()
    await win.waitForURL(/reader/, { timeout: 8000 })
    assert(win.url().includes('/reader/'), `M58: 点已下载文章标题直开阅读器 (${win.url()})`)
    await win.click('[data-testid="nav-订阅"]')
    await win.waitForSelector('[data-testid="subs-row"]', { timeout: 8000 })
    // 下载成功后 newRefs 清零——展开入口不得随之消失（v0.10.6 实录：自动下载后列表无法展开）
    await win.waitForSelector('[data-testid="subs-expand"]', { timeout: 8000 })
    const arrowText = await win.locator('[data-testid="subs-expand"]').first().innerText()
    assert(arrowText.includes('篇'), `M58: newRefs 清零后展开入口仍在 (saw: ${arrowText})`)
    await win.locator('[data-testid="subs-expand"]').first().click()
    await win.waitForSelector('[data-testid="subs-pending-item"]', { timeout: 8000 })
    assert(true, 'M58: 下载完成后重新展开仍见本轮明细')

    // ============ M49 · 现存设置继续可用（site-sync tooltip）============
    await win.click('[data-testid="nav-设置"]')
    await win.locator('[data-testid="site-sync-help"]').hover()
    await win.waitForSelector('.ant-tooltip-container', { timeout: 5000 })
    const tipText = await win.locator('.ant-tooltip-container').innerText()
    assert(tipText.includes('dreamble'), `site-sync tooltip mentions the dreamble repo (saw: ${tipText.slice(0, 40)})`)

    await win.screenshot({ path: '/tmp/wxk-e2e-final.png' })
    assert(errors.length === 0, `no console/page errors (saw ${errors.length}: ${errors.slice(0, 3).join(' | ')})`)

    // --- M21: 关窗后 activate 重建窗口 ---
    await win.close()
    let zero = -1
    for (let i = 0; i < 20; i++) {
      zero = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
      if (zero === 0) break
      await new Promise((r) => setTimeout(r, 100))
    }
    assert(zero === 0, 'closing the window leaves zero windows (app stays alive on darwin)')
    const reopened = app.waitForEvent('window')
    await app.evaluate(({ app: a }) => { a.emit('activate') })
    const win2 = await reopened
    await win2.waitForSelector('[data-testid="app-shell"]', { timeout: 20000 })
    assert(true, 'activate after close recreates the window with full UI')
    await app.evaluate(({ app: a }) => { a.emit('activate') })
    await win2.waitForTimeout(300)
    const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    assert(count === 1, 'activate with a window present does not open a duplicate')
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
