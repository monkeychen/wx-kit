#!/usr/bin/env node
// scripts/spike-mowen-api.mjs
// Spike: 墨问 API (open.mowen.cn) 可行性实测。
// 用法:
//   export MOWEN_API_KEY=...        # 密钥仅从环境变量读,不进命令行/不进文件
//   node scripts/spike-mowen-api.mjs
// 输出: stdout 5 段探点摘要 + /tmp/spike-mowen-{auth,note,images,list,error}.json(自动 redact key)
// 跑完即弃,不入库。

import { writeFileSync } from 'node:fs'

const KEY = process.env.MOWEN_API_KEY
if (!KEY) {
  console.error('ERROR: 请先 export MOWEN_API_KEY=... 后再跑。密钥不传命令行参数、不进文件。')
  process.exit(2)
}
const BASE = 'https://open.mowen.cn'
const REDACTED = '[REDACTED]'
const dumpKey = (k) => (k === KEY ? REDACTED : k)
const safe = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'string' && v === KEY ? REDACTED : v)))

async function api(method, path, body) {
  const url = `${BASE}${path}`
  const headers = {
    'Authorization': `Bearer ${dumpKey(KEY)}`,
    'Accept': 'application/json',
  }
  if (body) headers['Content-Type'] = 'application/json'
  const init = { method, headers }
  if (body) init.body = JSON.stringify(body)
  const res = await fetch(url, init)
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { _raw: text.slice(0, 500) } }
  return { status: res.status, ok: res.ok, json, headers: Object.fromEntries(res.headers) }
}

const out = {}
const log = (label, data) => { out[label] = data; console.log(`\n=== ${label} ===`); console.log(JSON.stringify(safe(data), null, 2)) }

// ─── A. 鉴权 ──────────────────────────────────────────────────────
// 文档无 /health,先用一个能跑的小接口试;找不到就试自己资料(若存在)
async function probeA() {
  console.log('\n[A] 鉴权: 试常见端点,看 Bearer 是否生效 + 401/403 形态')
  // 试探顺序: MyProfile(若存在) → DiscoverActivity(公开) → 错误 id 触发
  const tries = [
    ['MyProfile', '/api/v1/my/profile', 'POST'],
    ['DiscoverActivity', '/api/v1/discover/activity', 'POST'],
  ]
  const results = {}
  for (const [name, path, m] of tries) {
    const r = await api(m, path, name === 'DiscoverActivity' ? { count: 1 } : {})
    results[name] = { status: r.status, errCode: r.json?.errCode ?? r.json?.code, msg: r.json?.message ?? r.json?.msg ?? Object.keys(r.json || {}).slice(0, 5) }
  }
  log('A.鉴权', results)
  return results
}

// ─── B. 单篇拉取 ─────────────────────────────────────────────────
const NOTE_ID = 'PSwmO7_9FunjWit_9cw5h'  // 用户手册,已知公开
async function probeB() {
  console.log('\n[B] 单篇: NoteAtom 结构(从 GetNote / NoteInfo 等接口)')
  // 文档里没明示"按 id 拉 note", 试探:
  const paths = [
    ['POST', '/api/v1/note/info', { noteId: NOTE_ID }],
    ['POST', '/api/v1/note/get', { noteId: NOTE_ID }],
    ['POST', '/api/v1/note/detail', { noteId: NOTE_ID }],
    ['GET', `/api/v1/note/${NOTE_ID}`],
  ]
  const results = {}
  for (const [m, p, body] of paths) {
    const r = await api(m, p, body)
    results[`${m} ${p}`] = { status: r.status, topKeys: Object.keys(r.json || {}).slice(0, 20), errCode: r.json?.errCode ?? r.json?.code }
    if (r.ok && r.json) {
      writeFileSync(`/tmp/spike-mowen-note.json`, JSON.stringify(safe(r.json), null, 2))
    }
  }
  log('B.单篇', results)
  return results
}

// ─── C. 图片直链签名 ─────────────────────────────────────────────
// 看 NoteAtom.image.url 形态
async function probeC() {
  console.log('\n[C] 图片直链: 是否带 OSS Signature/Expires(决定下载策略)')
  try {
    const fs = await import('node:fs')
    const j = JSON.parse(fs.readFileSync('/tmp/spike-mowen-note.json', 'utf8'))
    const note = j?.data?.note ?? j?.data ?? j?.note ?? j
    const collect = (n, bag = []) => {
      if (!n || typeof n !== 'object') return bag
      if (Array.isArray(n)) { n.forEach((x) => collect(x, bag)); return bag }
      if (typeof n.url === 'string' && /\.(jpe?g|png|gif|webp)/i.test(n.url)) bag.push(n)
      for (const k of Object.keys(n)) collect(n[k], bag)
      return bag
    }
    const imgs = collect(note).slice(0, 3)
    const sample = imgs.map((i) => ({
      url: i.url,
      hasExpires: /Expires=\d+/.test(i.url),
      hasSignature: /Signature=/.test(i.url),
      oss: /oss|aliyuncs|mowen\.cn/.test(i.url),
    }))
    log('C.图片直链', { count: imgs.length, sample })
  } catch (e) { log('C.图片直链', { error: String(e) }) }
}

// ─── D. 列表/账号 ───────────────────────────────────────────────
async function probeD() {
  console.log('\n[D] 列表: UserNotes / UserActivity / DiscoverActivity 是否可用')
  const tries = [
    ['UserNotes', '/api/v1/user/notes', { count: 5 }],
    ['UserActivity', '/api/v1/user/activity', { count: 5 }],
    ['DiscoverActivity', '/api/v1/discover/activity', { count: 5 }],
  ]
  const results = {}
  for (const [name, path, body] of tries) {
    const r = await api('POST', path, body)
    const data = r.json?.data ?? {}
    results[name] = {
      status: r.status,
      errCode: r.json?.errCode,
      topKeys: Object.keys(data).slice(0, 10),
      itemCount: Array.isArray(data.notes) ? data.notes.length
        : Array.isArray(data.activities) ? data.activities.length
        : Array.isArray(data.items) ? data.items.length : null,
    }
  }
  log('D.列表', results)
  return results
}

// ─── E. 速率 + 错误码 ────────────────────────────────────────────
async function probeE() {
  console.log('\n[E] 速率: 连续 20 次请求同一接口,看是否限流')
  const path = '/api/v1/discover/activity'
  const samples = []
  let first429 = null
  for (let i = 0; i < 20; i++) {
    const t0 = Date.now()
    const r = await api('POST', path, { count: 1 })
    const ms = Date.now() - t0
    samples.push({ i, status: r.status, errCode: r.json?.errCode, ms })
    if (r.status === 429 || (r.json?.errCode && r.status >= 400)) {
      if (first429 === null) first429 = i
    }
  }
  // 错误码样本: 故意打错 id
  const wrong = await api('POST', '/api/v1/note/info', { noteId: '__INVALID_ID__' })
  log('E.速率+错误', { samples, firstBadAt: first429, wrongIdResponse: { status: wrong.status, errCode: wrong.json?.errCode, msg: wrong.json?.message } })
}

;(async () => {
  console.log('▸ spike 开始,所有响应 redact key')
  await probeA()
  await probeB()
  await probeC()
  await probeD()
  await probeE()
  writeFileSync('/tmp/spike-mowen-summary.json', JSON.stringify(safe(out), null, 2))
  console.log('\n▸ spike 完成 → /tmp/spike-mowen-*.json + /tmp/spike-mowen-summary.json')
})().catch((e) => { console.error('SPIKE ERROR:', e); process.exit(1) })