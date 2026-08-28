#!/usr/bin/env node
// scripts/spike-weread-chrome.mjs
// Spike：验证「本机系统 Chrome + 原生 CDP」能否打通微信读书文章列表（web/mp/articles）。
// 背景：weread 按网络栈指纹给会话分级，Electron/undici 恒 -2041，真 Chrome 可列（2026-08-27 实测）。
// 本脚本零额外依赖（Node 22 自带 WebSocket），复刻生产集成要做的事：
//   发现 Chrome → 无头启动（独立临时 profile，不碰用户日常会话）→ CDP 灌凭据 Cookie
//   → 打开 weread 首页（真实源 + JS 指纹）→ 页面内 fetch 翻页拉列表。
// 用法：node scripts/spike-weread-chrome.mjs [bookId] [页数]
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

const BOOK_ID = process.argv[2] ?? 'MP_WXS_3198966508'
const PAGES = Number(process.argv[3] ?? 3)
const CREDS_PATH = '/Users/simiam/Library/Application Support/wx-kit/weread-creds.json'

// ---------- Chrome 发现（mac 为主，附 win/linux 常见路径备查） ----------
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
]
function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p
  return null
}

// ---------- CDP 最小客户端 ----------
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Set()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) { const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result) }
      else if (msg.method) for (const h of this.handlers) h(msg)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  onEvent(fn) { this.handlers.add(fn) }
  close() { this.ws.close() }
}
function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.addEventListener('open', () => resolve(new Cdp(ws)))
    ws.addEventListener('error', () => reject(new Error('CDP ws 连接失败')))
  })
}
function getJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) })
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 主流程 ----------
async function main() {
  const t0 = Date.now()
  const chrome = findChrome()
  if (!chrome) { console.error('未找到系统 Chrome'); process.exit(1) }
  console.log('[1] Chrome:', chrome)

  const creds = JSON.parse(readFileSync(CREDS_PATH, 'utf8'))
  if (!creds.cookie) { console.error('凭据文件无 cookie 字段'); process.exit(1) }

  // 独立临时 profile：不碰用户日常 Chrome 会话
  const profileDir = mkdtempSync(join(tmpdir(), 'wxk-chrome-'))
  const proc = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=0`, `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const cleanup = () => { try { proc.kill() } catch {} ; try { rmSync(profileDir, { recursive: true, force: true }) } catch {} }
  process.on('exit', cleanup)

  try {
    // DevToolsActivePort 文件就绪（Chrome 启动后写入）
    const portFile = join(profileDir, 'DevToolsActivePort')
    let port = null
    for (let i = 0; i < 50; i++) {
      if (existsSync(portFile)) { port = Number(readFileSync(portFile, 'utf8').split('\n')[0]); break }
      await sleep(100)
    }
    if (!port) throw new Error('Chrome CDP 端口未就绪')
    console.log('[2] CDP 端口:', port, `(${Date.now() - t0}ms)`)

    // 取 page 级 ws 端点
    let targets = null
    for (let i = 0; i < 20; i++) {
      try { targets = await getJson(`http://127.0.0.1:${port}/json/list`); if (targets.length) break } catch {}
      await sleep(100)
    }
    const page = targets.find((t) => t.type === 'page')
    const cdp = await connectWs(page.webSocketDebuggerUrl)

    // 无头 UA 带 HeadlessChrome 标记，会被风控降级——覆写成正常 Chrome UA（Playwright 同款做法）
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    })

    // 灌凭据 Cookie 到该 Chrome 实例的 jar（校验每一枚的写入结果）
    const pairs = creds.cookie.split('; ').map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1) } })
    for (const c of pairs) {
      const r = await cdp.send('Network.setCookie', { ...c, domain: '.weread.qq.com', path: '/' })
      if (!r.success) throw new Error(`setCookie 失败: ${c.name}`)
    }
    const jarCheck = await cdp.send('Network.getCookies', { urls: ['https://weread.qq.com/'] })
    console.log('[3] jar 校验:', jarCheck.cookies.map((c) => c.name).join(','))
    const pairsRef = pairs

    // 先在 weread 源上开一个页面（供后续页内 fetch 同源执行）
    const loaded0 = new Promise((resolve) => cdp.onEvent((m) => { if (m.method === 'Page.loadEventFired') resolve() }))
    await cdp.send('Page.navigate', { url: 'https://weread.qq.com/' })
    await Promise.race([loaded0, sleep(8000)])

    // renewal 换新 skey（we-mp-rss/wxread 的三变体；页内 fetch 走真 Chrome 栈与自动 Set-Cookie）
    const renewVariants = [
      { rq: '%2Fweb%2Fbook%2Fread', ql: true },
      { rq: '%2Fweb%2Fbook%2Fread', ql: false },
      { rq: '%2Fweb%2Fbook%2Fread' },
    ]
    let renewed = false
    for (const body of renewVariants) {
      const expr = `fetch('/web/login/renewal', {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(r=>r.text())`
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
      console.log('[4] renewal', JSON.stringify(body), '->', String(r.result.value).slice(0, 80))
      const jar = await cdp.send('Network.getCookies', { urls: ['https://weread.qq.com/'] })
      const skey = jar.cookies.find((c) => c.name === 'wr_skey')
      const oldSkey = pairsRef.find((c) => c.name === 'wr_skey')?.value
      if (skey && skey.value && skey.value !== oldSkey) { console.log('    新 skey:', skey.value.slice(0, 4) + '***（发生轮换）'); renewed = true; break }
    }
    console.log('[4] renewal 结果:', renewed ? '轮换成功' : '未轮换')

    // 直接把列表 API 当页面打开：这一次导航本身就是带 jar Cookie 的列表请求，
    // 避免先开首页被游客 JS 下的匿名 Cookie 覆盖
    const listUrl = (off) => `https://weread.qq.com/web/mp/articles?bookId=${BOOK_ID}&offset=${off}`
    const all = []
    for (let p = 0; p < PAGES; p++) {
      const loaded = new Promise((resolve) => cdp.onEvent((m) => { if (m.method === 'Page.loadEventFired') resolve() }))
      await cdp.send('Page.navigate', { url: listUrl(p * 20) })
      await Promise.race([loaded, sleep(8000)])
      const body = await cdp.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true })
      let j
      try { j = JSON.parse(body.result.value) } catch { throw new Error('返回非 JSON: ' + String(body.result.value).slice(0, 120)) }
      const n = j?.reviews?.length ?? 0
      console.log(`[4] page ${p}: reviews=${n}${j?.errCode ? ' errCode=' + j.errCode : ''}`)
      if (!n) break
      for (const r of j.reviews) {
        const sub = r.subReviews?.[0]
        const info = sub?.review?.mpInfo
        if (info) all.push({ title: info.title, ts: info.time, reviewId: sub.reviewId })
      }
      if (n < 20) break
      await sleep(2600 + Math.floor(Math.random() * 2000))
    }
    console.log(`\n共取到 ${all.length} 篇（${Date.now() - t0}ms）`)
    for (const a of all.slice(0, 5)) console.log('  ·', new Date(a.ts * 1000).toISOString().slice(0, 16), a.title)
    if (all.length > 5) console.log('  …')
    cdp.close()
    console.log(all.length >= 3 ? '\nSPIKE: PASS ✅（真 Chrome 栈列表可用，可工程化集成）' : '\nSPIKE: 数据不足，需复查')
  } finally {
    cleanup()
  }
}

main().catch((e) => { console.error('SPIKE 失败:', e.message); process.exit(1) })
