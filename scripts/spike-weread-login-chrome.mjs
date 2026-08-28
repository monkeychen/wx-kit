#!/usr/bin/env node
// scripts/spike-weread-login-chrome.mjs
// Spike v2：扫码登录发生在真 Chrome 里 → 验证能否拿到「完整身份」（列表可列、renewal 可续）。
// 用法：node scripts/spike-weread-login-chrome.mjs
// 流程：弹出无痕 profile 的 Chrome 窗口到 weread 登录页 → 你用微信扫码 →
//       脚本轮询 jar 检测登录 → 自动验证列表翻页 + renewal → 打印 PASS/FAIL。
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

const BOOK_ID = process.argv[2] ?? 'MP_WXS_3198966508'
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
]

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
const connectWs = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url)
  ws.addEventListener('open', () => resolve(new Cdp(ws)))
  ws.addEventListener('error', () => reject(new Error('CDP ws 连接失败')))
})
const getJson = (url, timeoutMs = 3000) => new Promise((resolve, reject) => {
  const req = http.get(url, { timeout: timeoutMs }, (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) })
  req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const t0 = Date.now()
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!chrome) { console.error('未找到系统 Chrome'); process.exit(1) }
  const profileDir = mkdtempSync(join(tmpdir(), 'wxk-chrome-login-'))
  const proc = spawn(chrome, [
    `--remote-debugging-port=0`, `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', 'https://weread.qq.com/#login',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const cleanup = () => { try { proc.kill() } catch {}; try { rmSync(profileDir, { recursive: true, force: true }) } catch {} }
  process.on('exit', cleanup)

  try {
    const portFile = join(profileDir, 'DevToolsActivePort')
    let port = null
    for (let i = 0; i < 50 && !port; i++) { if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]); else await sleep(100) }
    let targets = null
    for (let i = 0; i < 20; i++) { try { targets = await getJson(`http://127.0.0.1:${port}/json/list`); if (targets?.length) break } catch {} ; await sleep(100) }
    const page = targets.find((t) => t.type === 'page')
    const cdp = await connectWs(page.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    console.log(`[1] Chrome 已打开登录页（${Date.now() - t0}ms）。请用微信扫码登录……`)

    // 轮询 jar 等 wr_skey 出现（最多 3 分钟）
    let skey = null, rt = null
    for (let i = 0; i < 90; i++) {
      const jar = await cdp.send('Network.getCookies', { urls: ['https://weread.qq.com/'] }).catch(() => ({ cookies: [] }))
      skey = jar.cookies.find((c) => c.name === 'wr_skey')?.value
      rt = jar.cookies.find((c) => c.name === 'wr_rt')?.value
      if (skey) break
      await sleep(2000)
    }
    if (!skey) { console.error('3 分钟内未检测到扫码登录，退出'); process.exit(1) }
    console.log(`[2] 登录成功！skey=${skey.slice(0, 4)}*** rt=${rt ? '有' : '无'}（${Date.now() - t0}ms）`)

    // 列表验证：页内 fetch 同源执行
    const fetchExpr = (url) => `fetch('${url}', {credentials:'include'}).then(r=>r.json())`
    const r1 = await cdp.send('Runtime.evaluate', { expression: fetchExpr(`/web/mp/articles?bookId=${BOOK_ID}&offset=0`), awaitPromise: true, returnByValue: true })
    const j1 = r1.result.value
    const n1 = j1?.reviews?.length ?? 0
    console.log(`[3] 列表 offset=0: ${n1} 条${j1?.errCode ? '（errCode ' + j1.errCode + '）' : ''}`)
    if (n1 > 0) console.log('    第一篇:', j1.reviews[0].subReviews[0].review.mpInfo.title)
    let n2 = 0
    if (n1 >= 20) {
      await sleep(2500 + Math.floor(Math.random() * 1500))
      const r2 = await cdp.send('Runtime.evaluate', { expression: fetchExpr(`/web/mp/articles?bookId=${BOOK_ID}&offset=20`), awaitPromise: true, returnByValue: true })
      n2 = r2.result.value?.reviews?.length ?? 0
      console.log(`[3] 列表 offset=20: ${n2} 条`)
    }

    // renewal 验证（完整身份才可能续期成功）
    const rr = await cdp.send('Runtime.evaluate', {
      expression: `fetch('/web/login/renewal', {method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({rq:'%2Fweb%2Fbook%2Fread',ql:true})}).then(r=>r.text())`,
      awaitPromise: true, returnByValue: true,
    })
    const jar2 = await cdp.send('Network.getCookies', { urls: ['https://weread.qq.com/'] })
    const newSkey = jar2.cookies.find((c) => c.name === 'wr_skey')?.value
    const rotated = newSkey && newSkey !== skey
    console.log(`[4] renewal: ${String(rr.result.value).slice(0, 80)} | skey${rotated ? '已轮换 ✓' : '未轮换'}`)

    console.log('\n──────────')
    if (n1 > 0) {
      console.log(`SPIKE: PASS ✅  真Chrome登录 = 完整身份（列表 ${n1}+${n2} 条${rotated ? '、可续期' : ''}）`)
      console.log('集成路径成立：登录窗口走系统 Chrome + CDP，凭据/会话由该 Chrome 托管。')
    } else {
      console.log('SPIKE: FAIL ❌  真 Chrome 登录后列表仍被拒——彻底排除客户端因素，服务端按账号/设备维度封禁，无工程解。')
    }
  } finally {
    await sleep(1500)   // 让最后的日志先落
    cleanup()
  }
}

main().catch((e) => { console.error('SPIKE 失败:', e.message); process.exit(1) })
