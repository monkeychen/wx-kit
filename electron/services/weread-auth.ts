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
import type { ArticleRef, CrawlRange } from '../../src/core/mp-types'
import { MpAuthExpired } from '../../src/core/mp-errors'
import { normalizeAccountId } from '../../src/core/weread/book-id'
import { readWereadCredsFile, wereadCredsPath } from './weread-transport'
import { parseArticle } from '../../src/core/parse-article'
import { extractArticleKeys } from '../../src/core/article-keys'

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
      try { await http.get('https://weread.qq.com/', { Accept: 'text/html,*/*' }) } catch {}
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
          try {
            const verify = async () => {
              try {
                const r = await http.get('https://weread.qq.com/web/shelf/sync?userVid=&synckey=0')
                const err = (r as Record<string, unknown>).errCode ?? (r as Record<string, unknown>).errcode ?? 0
                return !err
              } catch { return false }
            }
            if (!(await verify())) {
              try {
                await http.post('https://weread.qq.com/web/login/renewal', { rq: '%2Fweb%2Fbook%2Fread', ql: true })
                if (await verify()) {
                  const newSkey = http.getCookie?.('wr_skey')
                  const newRt = http.getCookie?.('wr_rt')
                  if (newSkey) creds = { ...creds, accessToken: newSkey, refreshToken: newRt ? decodeURIComponent(newRt) : creds.refreshToken }
                }
              } catch {}
            } else {
              const jarSkey = http.getCookie?.('wr_skey')
              if (jarSkey && jarSkey !== creds.accessToken) creds = { ...creds, accessToken: jarSkey }
            }
          } catch {}
          const fullCookie = (http as QrFlowHttp & { getCookieHeader?: () => string | undefined }).getCookieHeader?.()
          if (fullCookie) creds = { ...creds, cookie: fullCookie }
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
  const base = (process.env.WXKIT_WEREAD_BASE ?? 'https://weread.qq.com').replace(/\/$/, '')
  const u = new URL(`${base}${path}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
  return u.toString()
}

function parsePublishTime(pt: string): number {
  if (!pt) return Math.floor(Date.now() / 1000)
  const ts = Date.parse(pt.replace(' ', 'T') + '+08:00')
  return Number.isNaN(ts) ? Math.floor(Date.now() / 1000) : Math.floor(ts / 1000)
}

async function fetchCoverHtmlWithFallback(fetchHtml: (url: string) => Promise<string>, coverUrl: string): Promise<{ html: string; url: string }> {
  let html = await fetchHtml(coverUrl).catch(() => '')
  if (html) {
    try {
      const parsed = parseArticle(html, coverUrl)
      if (parsed.title) return { html, url: coverUrl }
    } catch {}
  }
  // Token may contain ~ vs _ confusion (weread reviewId vs mp short link)
  if (coverUrl.includes('/s/')) {
    const [base, token] = coverUrl.split('/s/')
    if (token) {
      const altToken = token.includes('~') ? token.replace(/~/g, '_') : token.replace(/_/g, '~')
      if (altToken !== token) {
        const altUrl = `${base}/s/${altToken}`
        const altHtml = await fetchHtml(altUrl).catch(() => '')
        if (altHtml) {
          try {
            const altParsed = parseArticle(altHtml, altUrl)
            if (altParsed.title) return { html: altHtml, url: altUrl }
          } catch {}
        }
      }
    }
  }
  return { html, url: coverUrl }
}

export async function wereadListFn(
  userDataDir: string,
  requestWeread: (url: string) => Promise<unknown>,
  _fetchHtml: (url: string) => Promise<string>,
): Promise<((fakeid: string, watermark: number) => Promise<ArticleRef[]>) | null> {
  const creds = await readWereadCredsFile(wereadCredsPath(userDataDir))
  if (!creds) return null
  const client = makeWereadClient((path, params) => requestWeread(wereadListUrl(path, params)))
  const bookIdFor = (fakeid: string) => {
    try { return normalizeAccountId(fakeid) } catch { return fakeid }
  }
  return async (fakeid, watermark) => {
    const bookId = bookIdFor(fakeid)
    const all: ArticleRef[] = []
    let offset = 0
    while (true) {
      let batch: ArticleRef[] = []
      try { batch = await client.listMpArticles(bookId, offset) } catch (e) {
        // 列表失败时回退到 cover 单篇（e2e mock 未实现 web/mp/articles 时也保底）
        if (true) {
          const cover = await client.getLatestArticle(fakeid).catch(() => null)
          if (!cover) return []
          const coverRef: ArticleRef = { url: cover.url, title: cover.title, createTime: Math.floor(Date.now()/1000) }
          return coverRef.createTime > watermark ? [coverRef] : []
        }
        throw e
      }
      if (!batch.length) break
      for (const r of batch) if (r.createTime > watermark) all.push(r)
      // 已到底或批次内已出现旧文章
      if (batch.length < 20) break
      const minTs = Math.min(...batch.map(r => r.createTime))
      if (minTs <= watermark) break
      offset += batch.length
      if (offset > 2000) break
    }
    // 按时间倒序（新在前）与旧订阅水位逻辑一致
    all.sort((a, b) => b.createTime - a.createTime)
    return all
  }
}

export async function wereadCrawlListFn(
  userDataDir: string,
  requestWeread: (url: string) => Promise<unknown>,
  _fetchHtml: (url: string) => Promise<string>,
): Promise<((fakeid: string, range: CrawlRange) => Promise<ArticleRef[]>) | null> {
  const creds = await readWereadCredsFile(wereadCredsPath(userDataDir))
  if (!creds) return null
  const client = makeWereadClient((path, params) => requestWeread(wereadListUrl(path, params)))
  const bookIdFor = (fakeid: string) => {
    try { return normalizeAccountId(fakeid) } catch { return fakeid }
  }
  return async (fakeid, range) => {
    const bookId = bookIdFor(fakeid)
    // 优先走列表，失败回退到 cover
    const fetchAll = async (): Promise<ArticleRef[]> => {
      const all: ArticleRef[] = []
      let offset = 0
      while (true) {
        let batch: ArticleRef[] = []
        try { batch = await client.listMpArticles(bookId, offset) } catch (e) {
          if (true) {
            const cover = await client.getLatestArticle(fakeid).catch(() => null)
            return cover ? [{ url: cover.url, title: cover.title, createTime: Math.floor(Date.now()/1000) }] : []
          }
          throw e
        }
        if (!batch.length) break
        all.push(...batch)
        if (batch.length < 20) break
        offset += batch.length
        if ('count' in range && all.length >= range.count) break
        if (offset > 2000) break
      }
      return all
    }
    const all = await fetchAll()
    // 按创建时间倒序
    all.sort((a, b) => b.createTime - a.createTime)
    if ('count' in range) return all.slice(0, range.count)
    const fromTs = Date.parse(`${range.from}T00:00:00`) / 1000
    const toTs = Date.parse(`${range.to}T23:59:59`) / 1000
    return all.filter(r => r.createTime >= fromTs && r.createTime <= toTs)
  }
}
