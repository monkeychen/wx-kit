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
// 墨问 note/show 同样 mock（M64 起覆盖「下载 → 阅读器引用卡片」）：
//   - WXKIT_MOWEN_BASE 把 note/show 指到 fixture server。该请求走 Node 的 fetch，
//     不经 Chromium 会话，webRequest 拦不到，只能换 base。
//   - 下载入口走「按链接下载」tab 粘 note.mowen.cn/detail/<id>（download-article 路由到
//     墨问分支），**不经过 mocli**——mocli 是外部二进制，隔离环境里有无不定，不能进 e2e。
//
// Run: npx vite build && node tests/e2e/gui.e2e.mjs   (or: npm run test:e2e)
import { _electron as electron } from 'playwright'
import http from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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

// 墨问夹具：父笔记正文里的引用块是 `<note uuid>` 纯占位标签（真机形态，正文本身不带标题），
// 标题得靠对被引用 uuid 再发一次 note/show 拉回来——v0.11.2 R1 的引用卡片就是这么来的。
// 子笔记元信息独立成条，用来同时验「卡片有标题」与「父子各一次请求」。
// 图集也是真机形态的坑：note/show 的图片池对图集不保证完整（3 声明只给 2），
// 缺的那张要靠第二个匿名接口 gallery/infos({noteUuid,gids}) 补（2026-09-17 真机钉死）。
const MOWEN_PARENT = 'MowenParent0000000001'
const MOWEN_CHILD = 'MowenChild00000000002'
const MOWEN_GID = 'MowenGallery000000001'
const MOWEN_GALLERY_UUIDS = ['MowenGalImg000000001', 'MowenGalImg000000002', 'MowenGalImg000000003']
const mowenImgUrl = (port) => `http://127.0.0.1:${port}/pic.png`
const MOWEN_NOTES = {
  [MOWEN_PARENT]: (port) => ({
    detail: {
      noteBase: {
        uuid: MOWEN_PARENT, title: '墨问父笔记', digest: '父笔记摘要',
        content: `<p>父笔记正文。</p><gallery uuid="${MOWEN_GID}"></gallery><p>关联阅读：</p><note uuid="${MOWEN_CHILD}"></note>`,
        publicAt: 1789088785,
      },
      // 池只给图集 3 张中的前 2 张——第三张必须走 gallery/infos 补拉
      noteFile: {
        images: Object.fromEntries(MOWEN_GALLERY_UUIDS.slice(0, 2).map((u) => [u, { url: mowenImgUrl(port), scale: { w_1200: mowenImgUrl(port) } }])),
      },
      noteGallery: { gids: [MOWEN_GID], gallerys: { [MOWEN_GID]: { gid: MOWEN_GID, fileUuids: MOWEN_GALLERY_UUIDS } } },
      noteRef: [MOWEN_CHILD],
    },
    user: { base: { uid: 'u-mowen-1', name: '墨问父作者' } },
  }),
  [MOWEN_CHILD]: () => ({
    detail: {
      noteBase: {
        uuid: MOWEN_CHILD, title: '子笔记标题甲', digest: '子笔记摘要乙',
        content: '<p>子笔记正文。</p>', publicAt: 1789000000,
      },
      noteFile: null,
      noteRef: [],
    },
    user: { base: { uid: 'u-mowen-2', name: '子笔记作者丙' } },
  }),
}

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
const TOPIC_E2E_KEY = 'wx-kit-topic-e2e-key'
const topicModelRequests = []
const readBody = (req) => new Promise((resolve) => {
  let s = ''
  req.on('data', (c) => { s += c })
  req.on('end', () => resolve(s))
})

async function main() {
  // --- fixture server ---
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    if (u.pathname.startsWith('/article/')) {
      const art = ARTICLES[u.pathname.slice('/article/'.length)] ?? ARTICLES.a1
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(makeHtml(server.address().port, art))
    } else if (u.pathname === '/api/note/wxa/v1/note/show') {
      // 墨问正文通道：按 uuid 回夹具；未登记 uuid 回 400 ASSET_NOT_FOUND（真机付费笔记的形态）
      const uuid = JSON.parse((await readBody(req)) || '{}').uuid
      const note = MOWEN_NOTES[uuid]
      res.writeHead(note ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(note ? note(server.address().port) : { code: 'ASSET_NOT_FOUND' }))
    } else if (u.pathname === '/api/note/wxa/v1/gallery/infos') {
      // 图集补拉：note/show 池不全会缺图，墨问网页端靠这个接口补齐（真机 2026-09-17 钉死）
      const { noteUuid, gids } = JSON.parse((await readBody(req)) || '{}')
      const note = noteUuid && MOWEN_NOTES[noteUuid] ? MOWEN_NOTES[noteUuid](server.address().port) : null
      const gallerys = note?.detail?.noteGallery?.gallerys ?? {}
      const wanted = (gids ?? []).filter((g) => gallerys[g])
      const images = Object.fromEntries((gallerys[wanted[0]]?.fileUuids ?? []).map((u2) => [u2, { url: mowenImgUrl(server.address().port), scale: { w_1200: mowenImgUrl(server.address().port) } }]))
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ gids: wanted, gallerys, images }))
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
    } else if (u.pathname === '/v1/chat/completions') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const input = JSON.parse(body.messages?.find((item) => item.role === 'user')?.content || '{}')
      topicModelRequests.push({ authorization: req.headers.authorization, taskVersion: input.taskVersion })
      let content
      if (input.taskVersion === 'topic-extract-v1') {
        const paragraphs = input.snapshot?.paragraphs ?? []
        content = {
          items: paragraphs.slice(0, 3).map((paragraph, index) => ({
            id: `x${index + 1}`,
            groupId: paragraph.groupId,
            paragraphId: paragraph.id,
            quote: paragraph.text.slice(0, Math.min(8, paragraph.text.length)),
            kind: index === 0 ? 'question' : index === 1 ? 'change' : 'opinion',
            summary: `材料摘要 ${index + 1}`,
            theme: '普通创作者如何从材料中找到值得写的问题',
          })),
        }
      } else {
        const extractions = input.extractions ?? []
        content = {
          cards: Array.from({ length: 3 }, (_, index) => {
            const extraction = extractions[index % extractions.length]
            return {
              id: `topic-e2e-${index + 1}`,
              question: `候选问题 ${index + 1}：这组材料能帮读者理解什么？`,
              angle: `从材料 ${index + 1} 的具体变化切入，不承诺传播结果。`,
              readerValues: [{
                kind: index === 0 ? 'knowledge' : index === 1 ? 'information-gap' : 'anxiety-relief',
                benefit: `让读者获得可核对的收获 ${index + 1}。`,
                evidenceIds: [`e${index + 1}`],
              }],
              rationale: `材料里存在可定位的具体表述 ${index + 1}。`,
              claims: [{
                text: `这组材料适合形成解释型文章 ${index + 1}。`,
                kind: 'editorial-inference',
                evidenceIds: [`e${index + 1}`],
              }],
              evidence: [{ id: `e${index + 1}`, extractionId: extraction.id, role: 'support' }],
              evidenceConfidence: { level: 'low', reasons: ['只有本地材料，没有读者行为数据。'] },
              distributionEvidence: 'unverified',
              limitations: ['平台传播效果没有数据支撑。'],
              missingEvidence: ['发布后的阅读与反馈数据。'],
              outline: ['用材料中的具体情境开篇。', '解释背后的原因。', '给出读者可执行的判断方法。'],
            }
          }),
        }
      }
      const text = JSON.stringify(content)
      // M75：按请求体 stream 标志分形态响应——生产链路默认 stream:true，
      // 这里真发 SSE 分块（跨 chunk 拼接走真实解析器），并留出可观察的实时输出窗口。
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        const piece = Math.max(1, Math.ceil(text.length / 6))
        for (let i = 0; i < text.length; i += piece) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + piece) } }] })}\n\n`)
          await new Promise(r => setTimeout(r, 120))
        }
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 50 } })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }))
      }
    } else if (u.pathname === '/pic.png' || u.pathname === '/cover.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG)
    } else { res.writeHead(404); res.end('no') }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const urlOf = (id) => `http://127.0.0.1:${port}/article/${id}`
  const wereadBase = `http://127.0.0.1:${port}`
  const mowenBase = wereadBase   // 墨问 note/show 的 mock 与微信读书共用同一个 fixture server
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

  // 无头/受限会话（agent 沙箱、CI）GPU 与 Chromium 沙箱起不来——WXKIT_E2E_HEADLESS=1 时禁用
  const headlessFlags = process.env.WXKIT_E2E_HEADLESS ? ['--disable-gpu', '--no-sandbox'] : []
  const app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot, `--user-data-dir=${userDataDir}`, ...headlessFlags],
    cwd: projectRoot,
    env: { ...process.env, WXKIT_WEREAD_BASE: wereadBase, WXKIT_MOWEN_BASE: mowenBase },
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
    // 顶层切换保持 Segmented（与订阅页平台切换同构）；tab 与内容的视觉统一靠两侧内容区
    // 同为 surface 白底卡片（MowenMode 内包 surface），2026-09-17 安哥确认此方向
    assert((await win.locator('[data-testid="download-mode-segmented"]').count()) === 1, 'M61: download mode segmented present')
    await win.locator('[data-testid="download-mode-segmented"] .ant-segmented-item:has-text("墨问笔记")').click()
    await win.waitForSelector('[data-testid="mowen-mode"]', { timeout: 5000 })
    assert((await win.locator('[data-testid="mowen-search-input"]').count()) === 1, 'M61: mowen tab shows user search input')
    // e2e 隔离环境 PATH 里 mocli 可达与否不定——指引条或正常搜索框二选一,不允许空白页
    const tabMissing = (await win.locator('[data-testid="mowen-tab-missing"]').count()) === 1
    assert(tabMissing || (await win.locator('[data-testid="mowen-tab-error"]').count()) === 0,
      'M61: mowen tab renders either the mocli-missing guide or a clean search state')
    // M65:搜索模式 Segmented（按用户/按关键词）——切换只换 placeholder 与按钮文案，
    // 输入框位置不动；搜索行为本身走真机验收（mocli 外部二进制不进 mock e2e）
    assert((await win.locator('[data-testid="mowen-mode-seg"]').count()) === 1, 'M65: mowen mode segmented present')
    await win.locator('[data-testid="mowen-mode-seg"] .ant-segmented-item:has-text("按关键词")').click()
    await win.waitForTimeout(200)
    let ph = await win.locator('[data-testid="mowen-search-input"] input').getAttribute('placeholder')
    assert(ph === '按关键词搜索全站墨问笔记', `M65: keyword mode placeholder (saw: ${ph})`)
    await win.locator('[data-testid="mowen-mode-seg"] .ant-segmented-item:has-text("按用户")').click()
    await win.waitForTimeout(200)
    ph = await win.locator('[data-testid="mowen-search-input"] input').getAttribute('placeholder')
    assert(ph === '按用户名/简介模糊搜索墨问用户', `M65: switch back to user mode restores placeholder (saw: ${ph})`)
    await win.locator('[data-testid="download-mode-segmented"] .ant-segmented-item:has-text("按链接下载")').click()
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
    await win.waitForSelector('[data-testid="settings-category-nav"]', { timeout: 10000 })
    for (const id of ['content', 'accounts', 'automation', 'ai', 'system']) {
      assert((await win.locator(`[data-testid="settings-cat-${id}"]`).count()) === 1,
        `M71: settings category ${id} is present`)
    }
    assert((await win.locator('[data-testid="settings-panel-content"]').count()) === 1,
      'M71: settings opens on content category')
    assert((await win.locator('[data-testid="settings-panel-accounts"]').count()) === 0,
      'M71: inactive category is not rendered')
    assert((await win.locator('.page-sub').count()) === 0,
      'M72: settings page renders no subtitle (removed by design)')
    assert((await win.locator('[data-testid="settings-panel-content"] [data-testid^="settings-group-"]').count()) === 2,
      'M72: content category renders exactly two independent group cards')
    assert((await win.locator('[data-testid="settings-group-library"]').count()) === 1,
      'M72: library group is distinct from download preferences')
    assert((await win.locator('[data-testid="settings-group-download"]').count()) === 1,
      'M72: download preference group is distinct')
    await win.waitForSelector('input[readonly]', { timeout: 10000 })
    assert((await win.inputValue('input[readonly]')) === libraryRoot, 'settings shows the seeded library root')

    await win.click('[data-testid="settings-cat-accounts"]')
    await win.waitForSelector('[data-testid="settings-panel-accounts"]', { timeout: 5000 })
    assert((await win.locator('[data-testid="mp-account"]').count()) === 1, 'v0.10.0: WeRead account section is present')
    const mpStatus = await win.locator('[data-testid="set-mp-status"]').innerText()
    assert(mpStatus.includes('已登录'), `v0.10.0: seeded WeRead creds reported as logged in (saw "${mpStatus}")`)
    assert((await win.locator('[data-testid="set-mp-logout"]').count()) === 1, 'v0.10.0: logout action is present')

    await win.click('[data-testid="settings-cat-automation"]')
    await win.waitForSelector('[data-testid="settings-panel-automation"]', { timeout: 5000 })
    assert((await win.locator('[data-testid="set-subs-auto"]').count()) === 1, 'v0.10.0: subscription settings are present')
    assert((await win.locator('[data-testid="site-sync-help"]').count()) === 1, 'settings keeps site-sync help')
    await win.click('[data-testid="set-site-sync"]')
    assert((await win.locator('[data-testid="settings-dirty-state"]').innerText()).includes('未保存'),
      'M71: editing a persistent setting marks the shared save bar dirty')
    await win.click('[data-testid="settings-cat-content"]')
    await win.click('[data-testid="settings-cat-automation"]')
    const siteSwitchClass = await win.locator('[data-testid="set-site-sync"]').getAttribute('class')
    assert(siteSwitchClass?.includes('ant-switch-checked'), 'M71: category switching preserves the unsaved draft')
    await win.click('[data-testid="settings-revert"]')
    const revertedSiteClass = await win.locator('[data-testid="set-site-sync"]').getAttribute('class')
    assert(!revertedSiteClass?.includes('ant-switch-checked'), 'M71: revert restores the last saved setting')
    await win.click('[data-testid="settings-cat-content"]')
    await win.fill('[data-testid="set-history-retention"]', '366')
    await win.click('[data-testid="settings-save"]')
    await win.waitForSelector('.ant-message-notice:has-text("已保存更改")', { timeout: 5000 })
    await win.click('[data-testid="settings-cat-accounts"]')
    await win.click('[data-testid="settings-cat-content"]')
    assert((await win.locator('[data-testid="set-history-retention"]').inputValue()) === '366',
      'M71: shared save persists ordinary settings across category navigation')

    await win.click('[data-testid="settings-cat-system"]')
    await win.waitForSelector('[data-testid="settings-panel-system"]', { timeout: 5000 })
    assert((await win.locator('[data-testid="mp-protection"]').count()) === 1, 'v0.10.0: request-protection settings are present')
    assert((await win.locator('[data-testid="about-check-update"]').count()) === 1, 'settings keeps the check-update action')
    assert((await win.locator('[data-testid="set-update-check"]').count()) === 1, 'settings keeps the startup-check toggle')

    // ============ M70 · 选题 AI 配置 + 三卡决策闭环 ============
    await win.click('[data-testid="settings-cat-ai"]')
    await win.waitForSelector('[data-testid="topic-ai-section"]', { timeout: 8000 })
    // M73：Base URL 由厂商选择派生；本地 fixture 端点要先切到「自定义」厂商才能编辑
    await win.click('[data-testid="topic-ai-provider"]')
    await win.locator('.ant-select-dropdown:visible .ant-select-item:has-text("自定义")').click()
    await win.waitForFunction(() => {
      const input = document.querySelector('[data-testid="topic-ai-base-url"]')
      return input instanceof HTMLInputElement && !input.readOnly
    }, { timeout: 5000 })
    await win.fill('[data-testid="topic-ai-base-url"]', `${wereadBase}/v1`)
    // AutoComplete 的 testid 在 antd Select 包装层上，fill 要打内部 input
    await win.fill('[data-testid="topic-ai-model"] input', 'fixture-topic-model')
    await win.fill('[data-testid="topic-ai-key"]', TOPIC_E2E_KEY)
    await win.click('[data-testid="settings-save"]')
    await win.waitForFunction(() => {
      const text = document.querySelector('[data-testid="topic-ai-key-status"]')?.textContent ?? ''
      return text.includes('已安全保存') || text.includes('已加密') || text.includes('仅本次会话')
    }, { timeout: 8000 })
    assert(true, 'M70: topic AI config reports persistent or honest session-only key status')
    await win.waitForSelector('.ant-message-notice:has-text("已保存更改")', { timeout: 5000 })

    await win.click('[data-testid="nav-选题"]')
    await win.waitForSelector('[data-testid="topics-page"]', { timeout: 8000 })
    const initialSelected = await win.locator('[data-testid="topic-card"][aria-checked="true"]').count()
    assert(initialSelected === 0, 'M70: topic page does not preselect a candidate')
    await win.click('[data-testid="topic-range"]')
    await win.locator('.ant-select-dropdown:visible .ant-select-item:has-text("自定义日期")').click()
    await win.fill('[data-testid="topic-date-from"]', '2026-02-01')
    await win.fill('[data-testid="topic-date-to"]', '2026-03-31')
    await win.click('[data-testid="topic-analyze"]')
    // M75：流式实时输出面板在结果落地前可见且内容增长
    await win.waitForSelector('[data-testid="topic-stream"]', { timeout: 8000 })
    const streamChars = async () => {
      const text = await win.locator('[data-testid="topic-stream-content"]').innerText()
      return text.length
    }
    const firstRead = await streamChars()
    await new Promise(r => setTimeout(r, 400))
    assert(firstRead > 0, 'M75: live stream panel shows model output while running')
    await win.waitForSelector('[data-testid="topic-card"]', { timeout: 30000 })
    assert((await win.locator('[data-testid="topic-stream"]').count()) === 0,
      'M75: stream panel clears when the run finishes')
    const topicCards = await win.locator('[data-testid="topic-card"]').count()
    assert(topicCards === 3, `M70: topic analysis renders three equal candidates (got ${topicCards})`)
    assert((await win.locator('[data-testid="topic-card"][aria-checked="true"]').count()) === 0,
      'M70: completed analysis still waits for the user to choose')
    assert(topicModelRequests.length === 2 && topicModelRequests.every(item => item.authorization === `Bearer ${TOPIC_E2E_KEY}`),
      'M70: local model receives exactly two authenticated stage requests')
    await win.locator('[data-testid="topic-card"]').first().click()
    await win.waitForSelector('[data-testid="topic-detail"]', { timeout: 5000 })
    assert((await win.locator('[data-testid="topic-detail"]').innerText()).includes('传播效果未验证'),
      'M70: detail keeps distribution evidence explicitly unverified')
    await win.locator('[data-testid="topic-detail"] .ant-tabs-tab:has-text("材料依据")').click()
    await win.waitForSelector('[data-testid="topic-evidence"]', { timeout: 5000 })
    assert((await win.locator('[data-testid="topic-detail"]').innerText()).includes('摘录存在不等于事实已验证'),
      'M70: evidence tab distinguishes excerpt matching from fact verification')
    await win.locator('[data-testid="topic-detail"] .ant-tabs-tab:has-text("怎么下笔")').click()
    assert((await win.locator('[data-testid="topic-outline"]').count()) === 1, 'M70: outline tab is available without another model request')
    await win.click('[data-testid="topic-feedback-watch"]')
    await win.waitForSelector('.ant-message-notice:has-text("已记录")', { timeout: 5000 })
    await win.click('[data-testid="topic-make-brief"]')
    await win.waitForSelector('[data-testid="topic-reveal-brief"]', { timeout: 5000 })
    const topicClipboard = await win.evaluate(() => navigator.clipboard.readText())
    assert(topicClipboard.includes('# 候选问题 1') && topicClipboard.includes('传播效果：未验证'),
      'M70: brief is generated and copied as Markdown')
    assert(topicModelRequests.length === 2, 'M70: switching tabs, feedback and brief do not call the model again')
    // M75：手动选篇——选范围→弹层勾选→分析走 manual 通道
    await win.click('[data-testid="topic-range"]')
    await win.locator('.ant-select-dropdown:visible .ant-select-item:has-text("手动选择文章")').click()
    await win.click('[data-testid="topic-manual-pick"]')
    await win.waitForSelector('[data-testid="topic-manual-list"]', { timeout: 5000 })
    await win.locator('[data-testid="topic-manual-list"] .topic-manual-row').first().click()
    await win.locator('[data-testid="topic-manual-list"] .topic-manual-row').nth(1).click()
    await win.locator('[data-testid="topic-manual-modal"] .ant-btn-primary').click()
    await win.waitForSelector('[data-testid="topic-manual-count"]', { timeout: 5000 })
    assert((await win.locator('[data-testid="topic-manual-count"]').innerText()).includes('2'),
      'M75: manual picker keeps the two chosen articles')
    await win.click('[data-testid="topic-analyze"]')
    await win.waitForSelector('[data-testid="topic-card"]', { timeout: 30000 })
    assert(topicModelRequests.length === 4, 'M75: manual run issues its own two authenticated model requests')
    {
      const runDirs = readdirSync(join(libraryRoot, 'topic-decisions', 'runs'))
      const manualRun = runDirs.map(dir => JSON.parse(readFileSync(join(libraryRoot, 'topic-decisions', 'runs', dir, 'result.json'), 'utf8')))
        .find(run => run.window?.preset === 'manual')
      assert(!!manualRun && manualRun.window.articleIds.length === 2 && manualRun.status === 'completed',
        'M75: manual window persists in run result and analysis completes')
    }
    await win.screenshot({ path: '/tmp/wxk-e2e-topics.png', fullPage: true })
    {
      const runFiles = readdirSync(join(libraryRoot, 'topic-decisions'), { recursive: true }).map(String)
        .filter(path => path.endsWith('result.json') || path.endsWith('trace.jsonl'))
      const persistedOutputs = runFiles.map(path => readFileSync(join(libraryRoot, 'topic-decisions', path), 'utf8')).join('\n')
      const settingsText = readFileSync(join(userDataDir, 'settings.json'), 'utf8')
      const mainLogText = readFileSync(join(userDataDir, 'logs', 'main.log'), 'utf8')
      const inspected = `${settingsText}\n${persistedOutputs}\n${mainLogText}`
      const submittedBodies = readdirSync(libraryRoot, { recursive: true }).map(String)
        .filter(path => path.endsWith('content.md') && !path.includes('topic-decisions'))
        .map(path => readFileSync(join(libraryRoot, path), 'utf8').trim())
        .filter(Boolean)
      assert(!inspected.includes(TOPIC_E2E_KEY) && !inspected.includes(`Bearer ${TOPIC_E2E_KEY}`),
        'M70: settings, result, trace and diagnostic log contain no API key or Authorization')
      assert(submittedBodies.length >= 3 && submittedBodies.every(body => !persistedOutputs.includes(body) && !mainLogText.includes(body)),
        'M70: result, trace and diagnostic log do not retain the submitted full article body')
    }
    await win.click('[data-testid="nav-设置"]')
    await win.click('[data-testid="settings-cat-ai"]')
    await win.waitForSelector('[data-testid="topic-ai-section"]', { timeout: 5000 })
    const savedKeyStatus = await win.locator('[data-testid="topic-ai-key-status"]').innerText()
    assert(savedKeyStatus.includes('已安全保存') || savedKeyStatus.includes('已加密') || savedKeyStatus.includes('仅本次会话'),
      `M70: returning to settings keeps an honest configured-key status (saw: ${savedKeyStatus})`)

    // ============ M60 · 设置页墨问集成区块（读缓存渲染，两种状态取其一）============
    await win.click('[data-testid="settings-cat-accounts"]')
    await win.waitForSelector('[data-testid="mowen-section"]', { timeout: 8000 })
    // 启动检测是 fire-and-forget，等它的 settings 写入落地后再断言（检测到/未检测到都算通过，形态必须二选一）
    await win.waitForTimeout(1500)
    const installed = (await win.locator('[data-testid="mowen-status-installed"]').count()) === 1
    const missing = (await win.locator('[data-testid="mowen-status-missing"]').count()) === 1
    assert(installed !== missing && (installed || missing),
      `M60: mowen section shows exactly one state (installed=${installed}, missing=${missing})`)
    assert((await win.locator('[data-testid="mowen-redetect"]').count()) === 1, 'M60: re-detect button is present')

    // ============ M66 · 设置页诊断区(按钮在,IPC 走通返回日志路径) ============
    await win.click('[data-testid="settings-cat-system"]')
    assert((await win.locator('[data-testid="diag-open-logs"]').count()) === 1, 'M66: diag open-logs button is present')
    {
      // 点击会真调 shell.showItemInFolder(Finder 打开目录)——e2e 沙箱 userData 下无副作用风险,
      // 断言 IPC 契约:ok + main.log 绝对路径(GUI 进程 init 过 diag-log,必然非空)
      const diagResp = await win.evaluate(() => window.api.diagOpenLogsFolder())
      assert(diagResp?.ok === true && /main\.log$/.test(diagResp.path ?? ''),
        `M66: diag IPC returns ok + log path (saw ${JSON.stringify(diagResp)})`)
    }
    await win.click('[data-testid="settings-cat-content"]')
    await win.screenshot({ path: '/tmp/wxk-e2e-settings-m71.png', fullPage: true })

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

    // ============ M63 · 订阅页平台 tab：墨问作者 ============
    // e2e 隔离环境 mocli 可达与否不定——指引态或搜索态二选一，不允许空白页
    await win.locator('.ant-segmented-item:has-text("墨问")').click()
    await win.waitForSelector('[data-testid="mowen-subs-guide"], [data-testid="mowen-subs-kw"]', { timeout: 5000 })
    assert(true, 'M63: 墨问订阅面板渲染（指引态或搜索态）')
    await win.locator('.ant-segmented-item:has-text("公众号")').click()
    await win.waitForSelector('[data-testid="subs-search-input"]', { timeout: 5000 })
    assert(true, 'M63: 切回公众号面板，微信订阅内容仍在')

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
    await win.click('[data-testid="settings-cat-automation"]')
    await win.locator('[data-testid="site-sync-help"]').hover()
    await win.waitForSelector('.ant-tooltip-container', { timeout: 5000 })
    const tipText = await win.locator('.ant-tooltip-container').innerText()
    assert(tipText.includes('dreamble'), `site-sync tooltip mentions the dreamble repo (saw: ${tipText.slice(0, 40)})`)

    // ============ M64 · 墨问笔记下载 → 阅读器引用卡片（v0.11.2 R1）============
    // 引用块的真实形态是 <note uuid> 纯占位标签、正文本身不带标题（与 <img uuid> 同模式），
    // 标题靠对被引用 uuid 再发一次 note/show 拉回来。本用例钉死「原地渲染成带标题的卡片」
    // 这条链路，并验 md 导出不丢标题（turndown 转 > 引用块）。
    await win.click('[data-testid="nav-下载"]')
    await win.waitForSelector('[data-testid="url-input"]', { timeout: 5000 })
    await win.fill('[data-testid="url-input"]', `https://note.mowen.cn/detail/${MOWEN_PARENT}`)
    await win.click('[data-testid="start-download"]')
    await win.waitForSelector('[data-testid="history-event"]', { timeout: 30000 })
    await win.waitForSelector('[data-testid="history-article"]', { timeout: 10000 })
    const mowenItem = await topEvent().locator('[data-testid="history-article"]').first().innerText()
    assert(mowenItem.includes('墨问父笔记'), `M64: 墨问链接经「按链接下载」入库 (saw: ${mowenItem.slice(0, 30)})`)

    await topEvent().locator('[data-testid="history-read"]').first().click()
    await win.waitForURL(/reader/, { timeout: 8000 })
    await win.click('.ant-segmented >> text=网页')
    await win.waitForSelector('iframe', { timeout: 10000 })
    const refSrc = await win.getAttribute('iframe', 'src')
    const refHtml = await app.evaluate(async ({ net }, u) => await (await net.fetch(u)).text(), refSrc)
    assert(refHtml.includes('mowen-ref-card'), 'M64: 阅读器渲染引用卡片（blockquote.mowen-ref-card）')
    assert(refHtml.includes('《子笔记标题甲》'), 'M64: 引用卡片带被引用笔记标题（v0.11.2 R1 核心）')
    assert(refHtml.includes('子笔记作者丙'), 'M64: 引用卡片带被引用笔记作者')
    assert(!refHtml.includes('引用笔记（'), 'M64: 旧尾部追加块已退场（同一信息不再两处重复）')

    const mowenMdRel = readdirSync(libraryRoot, { recursive: true }).map(String)
      .find((p) => p.endsWith('content.md') && p.includes('墨问'))
    assert(!!mowenMdRel, 'M64: 墨问笔记落盘到文库（content.md）')
    const mowenMd = readFileSync(join(libraryRoot, mowenMdRel), 'utf-8')
    assert(mowenMd.includes('《子笔记标题甲》'), 'M64: md 导出引用块带标题（turndown 不丢）')
    // 图集缺图补拉（gallery/infos）：池只给 2/3，第三张必须从 gallery/infos 来
    const mowenImgCount = (mowenMd.match(/!\[/g) || []).length
    assert(mowenImgCount === 3, `M64: 图集 3 张图全落盘（池 2 + gallery/infos 补 1，got ${mowenImgCount}）`)
    const refImgCount = (refHtml.match(/<img /g) || []).length
    assert(refImgCount === 3, `M64: 阅读器 html 渲染 3 张图集图（got ${refImgCount}）`)

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
