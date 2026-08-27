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
  const getJson = async (url: string, headers?: Record<string, string>) => {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Origin: 'https://weread.qq.com',
        Referer: 'https://weread.qq.com/',
        ...headers,
      },
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) throw new Error(`weread qr-flow HTTP ${res.status}: ${url.slice(0, 80)}`)
    return await res.json() as Record<string, unknown>
  }
  return {
    get: getJson,
    post: async (url, body, headers) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Origin: 'https://weread.qq.com',
          Referer: 'https://weread.qq.com/',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      })
      const payload = await res.json().catch(() => { throw new Error(`weread login 响应非 JSON（HTTP ${res.status}）`) })
      return payload as Record<string, unknown>
    },
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
          const creds = (poll as { state: 'confirmed'; creds: WereadCredentials }).creds
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

export async function wereadListFn(
  userDataDir: string,
  requestWeread: (url: string) => Promise<unknown>,
  fetchHtml: (url: string) => Promise<string>,
): Promise<((fakeid: string, watermark: number) => Promise<ArticleRef[]>) | null> {
  const creds = await readWereadCredsFile(wereadCredsPath(userDataDir))
  if (!creds) return null
  const client = makeWereadClient((path, params) => requestWeread(wereadListUrl(path, params)))
  return async (fakeid, watermark) => {
    const cover = await client.getLatestArticle(fakeid)
    if (!cover) return []
    const html = await fetchHtml(cover.url).catch(() => '')
    if (!html) return []
    const parsed = parseArticle(html, cover.url)
    const ts = parsePublishTime(parsed.publishTime)
    if (ts <= watermark) return []
    const keys = extractArticleKeys(html)
    return [{
      url: cover.url,
      title: cover.title,
      createTime: ts,
      ...(keys.mid ? { appmsgid: Number(keys.mid) } : {}),
      ...(keys.idx ? { itemidx: Number(keys.idx) } : {})
    }]
  }
}

export async function wereadCrawlListFn(
  userDataDir: string,
  requestWeread: (url: string) => Promise<unknown>,
  fetchHtml: (url: string) => Promise<string>,
): Promise<((fakeid: string, range: CrawlRange) => Promise<ArticleRef[]>) | null> {
  const creds = await readWereadCredsFile(wereadCredsPath(userDataDir))
  if (!creds) return null
  const client = makeWereadClient((path, params) => requestWeread(wereadListUrl(path, params)))
  return async (fakeid, range) => {
    const cover = await client.getLatestArticle(fakeid)
    if (!cover) return []
    const html = await fetchHtml(cover.url).catch(() => '')
    if (!html) return []
    const parsed = parseArticle(html, cover.url)
    const ts = parsePublishTime(parsed.publishTime)
    const keys = extractArticleKeys(html)
    const ref = {
      url: cover.url,
      title: cover.title,
      createTime: ts,
      ...(keys.mid ? { appmsgid: Number(keys.mid) } : {}),
      ...(keys.idx ? { itemidx: Number(keys.idx) } : {})
    }
    if ('count' in range) {
      return [ref]
    } else {
      const fromTs = Date.parse(`${range.from}T00:00:00`) / 1000
      const toTs = Date.parse(`${range.to}T23:59:59`) / 1000
      if (ts < fromTs || ts > toTs) return []
      return [ref]
    }
  }
}
