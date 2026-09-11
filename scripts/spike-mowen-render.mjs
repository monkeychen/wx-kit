#!/usr/bin/env node
// scripts/spike-mowen-render.mjs
// Spike: 用 wx-kit 自己的 Electron BrowserWindow(offscreen) 加载 mowen 详情页,
//       executeJavaScript 拿 innerText,验证「登录态是否必需」。
// 跑法: ELECTRON_RUN_AS_NODE=0 npx electron scripts/spike-mowen-render.mjs <noteId> [withCookieFile]
// 输出: stdout 一段 JSON { noteId, hasContent, snippet, matchedKeywords }
// 跑完即弃。

import { app, BrowserWindow, session } from 'electron'
import { readFileSync } from 'node:fs'

const noteId = process.argv[2]
const cookieFile = process.argv[3]
if (!noteId) { console.error('usage: npx electron spike-mowen-render.mjs <noteId> [cookieFile]'); app.exit(2) }

const url = `https://note.mowen.cn/detail/${noteId}`

async function loadAndDump(label) {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
  try {
    // 可选: 注入 cookie（mocli cookie 文件 → mowen 域）
    if (cookieFile) {
      const raw = readFileSync(cookieFile, 'utf8')
      const cookies = raw.split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => {
        const [d, , , , n, v] = l.split('\t')
        return { domain: d, name: n, value: v, url: 'https://note.mowen.cn' }
      })
      for (const c of cookies) {
        try { await session.defaultSession.cookies.set(c) } catch (e) { /* skip malformed */ }
      }
    }

    await win.loadURL(url, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' })
    // Vue SPA 需要等异步加载 + 渲染,简单轮询 innerText 长度变化
    let text = '', stableCount = 0, prev = ''
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000))
        text = await win.webContents.executeJavaScript('document.querySelector("#app")?.innerText || ""')
        if (text === prev) stableCount++; else { stableCount = 0; prev = text }
        if (stableCount >= 3 && text.length > 100) break
      }
    const hasContent = text.length > 100
    const matchedKeywords = (text.match(/京东健康|A380|驾驶舱|被束缚|操作指引/g) || [])
    const snippet = text.slice(0, 400)
    console.log(JSON.stringify({ label, noteId, hasContent, textLength: text.length, matchedKeywords, snippet }, null, 2))
  } finally {
    win.destroy()
  }
}

app.whenReady().then(async () => {
  await loadAndDump(cookieFile ? 'with-cookie' : 'no-cookie')
  app.exit(0)
}).catch(e => { console.error('ERR:', e); app.exit(1) })