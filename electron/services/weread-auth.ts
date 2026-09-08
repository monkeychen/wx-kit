// electron/services/weread-auth.ts
// 微信读书登录的编排层：Web 端扫码全流程、凭据续期、WereadClient 工厂。
import { join } from 'node:path'
import { WereadCredsStore, refreshWereadCreds } from '../../src/core/weread/creds-store'
import {
  getLoginUid, webConfirmUrl, buildWebPollUrl, parseWebLoginPoll,
  type QrFlowHttp,
} from '../../src/core/weread/qr-flow'
import { WereadClient } from '../../src/core/weread/client'
import type { WereadCredentials, WereadQrPoll } from '../../src/core/weread/types'
import { normalizeAccountId } from '../../src/core/weread/book-id'
import type { ArticleRef, CrawlRange } from '../../src/core/mp-types'
import { MpAuthExpired } from '../../src/core/mp-errors'
import { readWereadCredsFile, wereadCredsPath } from './weread-transport'
import { wereadCookieHeader } from './weread-net'

export interface WereadLoginDeps {
  runAction: <T>(task: () => Promise<T>) => Promise<T>
  http?: QrFlowHttp
  now?: () => number
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

export function nodeQrHttp(): QrFlowHttp {
  const jar = new Map<string, string>()
  const parseSetCookie = (res: Response) => {
    const cookies: string[] = []
    const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie
    if (typeof getSetCookie === 'function') {
      cookies.push(...getSetCookie.call(res.headers))
    } else {
      const single = res.headers.get('set-cookie')
      if (single) cookies.push(single)
    }
    for (const c of cookies) {
      const m = /^([^=]+)=([^;]*)/.exec(c)
      if (m) jar.set(m[1].trim(), decodeURIComponent(m[2].trim()))
    }
  }
  const cookieHeader = () => {
    if (!jar.size) return undefined
    return [...jar.entries()].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ')
  }
  const getJson = async (url: string, headers?: Record<string, string>) => {
    const cookie = cookieHeader()
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Origin: 'https://weread.qq.com',
        Referer: 'https://weread.qq.com/',
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      signal: AbortSignal.timeout(25_000),
    })
    parseSetCookie(res)
    if (!res.ok) throw new Error(`weread qr-flow HTTP ${res.status}: ${url.slice(0, 80)}`)
    return await res.json() as Record<string, unknown>
  }
  return {
    get: getJson,
    post: async (url, body, headers) => {
      const cookie = cookieHeader()
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Origin: 'https://weread.qq.com',
          Referer: 'https://weread.qq.com/',
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      })
      parseSetCookie(res)
      const payload = await res.json().catch(() => { throw new Error(`weread login 响应非 JSON（HTTP ${res.status}）`) })
      return payload as Record<string, unknown>
    },
    getCookie: (name: string) => jar.get(name),
    getCookieHeader: () => cookieHeader(),
  }
}

export class WereadLoginCancelled extends Error {
  constructor() { super('用户取消了微信读书扫码登录'); this.name = 'WereadLoginCancelled' }
}

export async function runWereadLogin(
  store: WereadCredsStore,
  deps: WereadLoginDeps,
  hooks: {
    onQr?: (qr: { uuid: string; confirmUrl: string }) => void
    onState?: (s: WereadQrPoll['state']) => void
    cancel?: () => boolean
  } = {},
): Promise<WereadCredentials> {
  const http = deps.http ?? nodeQrHttp()
  const interval = deps.pollIntervalMs ?? 2_000
  const deadline = (deps.now ?? Date.now)() + (deps.pollTimeoutMs ?? 10 * 60_000)

  return deps.runAction(async () => {
    for (;;) {
      try { await http.get('https://weread.qq.com/', { Accept: 'text/html,*/*' }) } catch { /* 首页预热拿指纹 Cookie；失败不阻断扫码链路 */ }
      const uid = await getLoginUid(http)
      const confirmUrl = webConfirmUrl(uid)
      hooks.onQr?.({ uuid: uid, confirmUrl })
      for (;;) {
        if (hooks.cancel?.()) throw new WereadLoginCancelled()
        if ((deps.now ?? Date.now)() > deadline) throw new Error('微信读书扫码超时未确认，请重试')
        let poll: ReturnType<typeof parseWebLoginPoll>
        try {
          const payload = await http.get(buildWebPollUrl(uid), {
            Accept: 'application/json, text/plain, */*',
          })
          poll = parseWebLoginPoll(payload)
        } catch (e) {
          if (hooks.cancel?.()) throw new WereadLoginCancelled()
          throw e
        }
        if (poll.state === 'confirmed') {
          let creds = (poll as { state: 'confirmed'; creds: WereadCredentials }).creds
          // 登录产生的全量 Cookie 落在 Chromium 分区 jar 里；导出成字符串随凭据落盘，
          // 供业务请求与 session export/import 使用。jar 为空（纯 Node 单测）时保持 JSON 字段。
          try {
            const fullCookie = await wereadCookieHeader()
            if (fullCookie) creds = { ...creds, cookie: fullCookie }
          } catch { /* 非 Electron 环境（单测）无分区 jar */ }
          await store.write(creds)
          return creds
        }
        if (poll.state === 'expired') break
        if (poll.state === 'declined') throw new MpAuthExpired('你在微信中取消了登录，请重新发起')
        if ((poll as { state: string }).state === 'need_otp') throw new MpAuthExpired('微信读书登录需要验证码，暂不支持')
        hooks.onState?.(poll.state as WereadQrPoll['state'])
        await new Promise((r) => setTimeout(r, interval))
      }
    }
  })
}

export async function ensureFreshWereadCreds(
  store: WereadCredsStore,
  http: QrFlowHttp = nodeQrHttp(),
): Promise<WereadCredentials> {
  const creds = await store.read()
  if (!creds) throw new MpAuthExpired('尚未登录微信读书，请先扫码登录')
  if (!creds.refreshToken) return creds
  try {
    const next = await refreshWereadCreds(http, creds)
    await store.write(next)
    return next
  } catch {
    return creds
  }
}

export function wereadCredsStore(userDataDir: string): WereadCredsStore {
  return new WereadCredsStore(join(userDataDir, 'weread-creds.json'))
}

export function makeWereadClient(
  gatewayRequest: (path: string, params: Record<string, string | number>) => Promise<unknown>,
): WereadClient {
  return new WereadClient(gatewayRequest)
}

export function wereadListUrl(path: string, params: Record<string, string | number>): string {
  // Plan B：WXKIT_WEREAD_BASE 仅供 e2e 把请求指到本地 mock（默认生产域名）
  const base = (process.env.WXKIT_WEREAD_BASE ?? 'https://weread.qq.com').replace(/\/$/, '')
  const u = new URL(`${base}${path}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
  return u.toString()
}

/** 列表分页上限（每页 20，200 页 ≈ 4000 篇），防御性兜底避免死循环 */
const MAX_LIST_PAGES = 200
const PAGE_SIZE = 20

function normalizeBookId(fakeid: string): string {
  try { return normalizeAccountId(fakeid) } catch { return fakeid }
}

async function listAllArticles(client: WereadClient, bookId: string): Promise<ArticleRef[]> {
  const all: ArticleRef[] = []
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const batch = await client.listMpArticles(bookId, page * PAGE_SIZE)
    if (!batch.length) break
    all.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  all.sort((x, y) => y.createTime - x.createTime)
  return all
}

/** 列表失败（-2041 等）时回退 cover 单篇——增量订阅的保底路径 */
async function fallbackToCover(client: WereadClient, fakeid: string): Promise<ArticleRef[]> {
  const cover = await client.getLatestArticle(fakeid).catch((e) => {
    // 鉴权失效绝不能吞成「空列表」——上层会把空解读为「没有新文章」（v0.10.4 实录：
    // wr_skey 过期后检查一直报无新文章）。MpAuthExpired 上抛交 checkSubscriptions 整体中止。
    if (e instanceof MpAuthExpired) throw e
    return null
  })
  if (!cover) return []
  const token = cover.reviewId.split('_').pop() || ''
  return [{
    url: cover.url || `https://mp.weixin.qq.com/s/${token}`,
    title: cover.title,
    // cover 没有发布时间；这个时间只用于待处理列表排序与展示，判重必须使用 reviewId。
    createTime: Math.floor(Date.now() / 1000),
    sourceId: cover.reviewId,
  }]
}

/**
 * 订阅检查专用取件器。列表端点已确认服务端封禁，生产订阅直接取 cover 最新一篇。
 * `watermark` 为兼容旧调用保留；cover 的新旧判断由上层按 reviewId 完成。
 */
export async function wereadListFn(
  userDataDir: string,
  requestWeread: (url: string) => Promise<unknown>,
): Promise<((fakeid: string, watermark: number) => Promise<ArticleRef[]>) | null> {
  const creds = await readWereadCredsFile(wereadCredsPath(userDataDir))
  if (!creds) return null
  const client = makeWereadClient((path, params) => requestWeread(wereadListUrl(path, params)))
  return async (fakeid, _watermark) => fallbackToCover(client, fakeid)
}

/**
 * 批量抓取/摘要专用的列表取件装配。全量分页后按 count/日期裁剪；列表不可用时回退 cover 单篇。
 */
export async function wereadCrawlListFn(
  userDataDir: string,
  requestWeread: (url: string) => Promise<unknown>,
): Promise<((fakeid: string, range: CrawlRange) => Promise<ArticleRef[]>) | null> {
  const creds = await readWereadCredsFile(wereadCredsPath(userDataDir))
  if (!creds) return null
  const client = makeWereadClient((path, params) => requestWeread(wereadListUrl(path, params)))
  return async (fakeid, range) => {
    const bookId = normalizeBookId(fakeid)
    let all: ArticleRef[]
    try {
      all = await listAllArticles(client, bookId)
    } catch {
      // 同订阅：列表不可用即回退 cover 单篇，批量能力随接口恢复自动回归
      all = await fallbackToCover(client, fakeid)
    }
    if ('count' in range) return all.slice(0, range.count)
    const fromTs = Date.parse(`${range.from}T00:00:00`) / 1000
    const toTs = Date.parse(`${range.to}T23:59:59`) / 1000
    return all.filter((r) => r.createTime >= fromTs && r.createTime <= toTs)
  }
}
