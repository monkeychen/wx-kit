#!/usr/bin/env node
// Spike：微信读书通道能否拿到公众号文章的「阅读数」类指标（看过数/阅读数/点赞数）。
// 背景：v0.10.3 需求收集——安哥想看文章阅读数等关键信息。微信原生阅读数被登录态隔离拿不到，
// 唯一现实通道是微信读书侧的计数。本脚本对生产链路已验证的接口做实测，dump 原始 payload 找字段。
//
// **2026-09-07 spike 终局：微信读书通道拿不到任何计数，勿重复投入。**
// - cover（唯一活着的微信读书公众号接口）：完整 payload 只有 avatar/name/title/pic/reviewId/
//   template/coverBoxInfo，无 readNum/likeNum/reviewCount 等任何计数字段；
// - 盲探 /api|/web 前缀的 mp/review、mp/article、mp/info、book/info 共 6 条路径：全 404 或 -2003；
// - 「看过」数若存在于微信读书 App UI，也在移动端接口体系里——该体系（web/mp/articles、
//   mp/chapters）已被服务端按账号封禁（见 AGENTS.md 列表封禁终局）；
// - 微信原生阅读数（getappmsgext）需手机微信客户端登录态 key（第三方 wechatarticles 项目即此
//   路线：手机抓包、key 短时效），与桌面产品形态不兼容，且违背「不重新引入代理抓取」的已定决策；
// - 第三方数据商（新榜等）需注册付费 token，超出产品定位。
// 用法：node scripts/spike-weread-readcount.mjs [bookId]
//   bookId 缺省用本机第一个已订阅号（MP_WXS_ 形态）。
// 注意：直连（unset 代理）；只打印 payload，绝不打印 Cookie。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CREDS_PATH = join(homedir(), 'Library', 'Application Support', 'wx-kit', 'weread-creds.json')
const BASE = 'https://weread.qq.com'

const creds = JSON.parse(await readFile(CREDS_PATH, 'utf-8'))
if (!creds.cookie) { console.error('no cookie in creds'); process.exit(1) }

const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Cookie: creds.cookie,
}

async function get(path, params) {
  const u = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
  const res = await fetch(u, { headers: HEADERS })
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { return { status: res.status, body: text.slice(0, 500) } }
}

function bookIdFromCredsFallback() {
  // 从订阅文件取第一个号的 MP_WXS_ 前缀（latestArticleId = MP_WXS_<id>_<token>）
  return null
}

let bookId = process.argv[2] ?? ''
if (!bookId) {
  const subsPath = join(homedir(), 'Documents', 'wx-kit', 'subscriptions.json')
  const subs = JSON.parse(await readFile(subsPath, 'utf-8'))
  const accounts = Array.isArray(subs) ? subs : subs.accounts
  const first = accounts.find((a) => a.subscribed && a.latestArticleId) ?? accounts[0]
  // latestArticleId 形如 MP_WXS_<id>_<token>，bookId 是前 3 段（MP_WXS 自带下划线）
  bookId = first.latestArticleId.split('_').slice(0, 3).join('_')
  console.log(`[fallback bookId] ${bookId} (${first.nickname})`)
}

console.log('\n===== 1. /api/mp/cover（生产在用，看完整字段） =====')
const cover = await get('/api/mp/cover', { bookId })
console.log(`status=${cover.status}`)
console.log(JSON.stringify(cover.body, null, 2))

// reviewId → 文章维度探测。微信读书的「review」体系承载「看过/想法」，reviewId 暗示存在 review 维度接口。
const reviewId = cover.body?.reviewId ?? cover.body?.data?.reviewId ?? ''
console.log(`\n[reviewId] ${reviewId}`)

const probes = []
if (reviewId) {
  probes.push(
    ['/api/mp/review', { reviewId }, 'reviewId 维度'],
    ['/api/mp/review/info', { reviewId }, 'reviewId 维度'],
    ['/web/mp/review/info', { reviewId }, 'web 前缀 reviewId 维度'],
    ['/api/mp/article/info', { reviewId }, '文章详情'],
    ['/web/mp/article/info', { reviewId }, 'web 前缀文章详情'],
  )
}
probes.push(
  ['/api/mp/info', { bookId }, 'bookId 公众号信息'],
  ['/api/book/info', { bookId }, 'bookId 书籍信息（公众号是特殊 book，或带 readCount/rating）'],
  ['/web/book/info', { bookId }, 'web 前缀书籍信息'],
)

for (const [path, params, note] of probes) {
  console.log(`\n===== probe ${path}（${note}） =====`)
  const r = await get(path, params)
  const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
  console.log(`status=${r.status} body=${body.slice(0, 1200)}`)
}
