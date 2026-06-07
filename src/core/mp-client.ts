// src/core/mp-client.ts
import type { MpFetch, MpAccount, ArticleRef, CrawlRange, MpJson } from './mp-types'
import { MpRateLimited, MpAuthExpired, MpApiError } from './mp-errors'

const SEARCHBIZ = 'https://mp.weixin.qq.com/cgi-bin/searchbiz'
const APPMSG = 'https://mp.weixin.qq.com/cgi-bin/appmsg'
const PAGE = 20

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
export const randMs = (min: number, max: number): number => Math.floor(min + Math.random() * (max - min))

/** 检查 base_resp.ret，把已知风控/失效码翻译成具体异常。 */
export function checkRet(json: MpJson): void {
  const ret = json.base_resp?.ret ?? 0
  if (ret === 0) return
  if (ret === 200013) throw new MpRateLimited('微信频率限制（200013）')
  if (ret === 200040) throw new MpAuthExpired('登录态失效（200040）')
  throw new MpApiError(ret, json.base_resp?.err_msg ?? `mp api ret=${ret}`)
}

export async function searchAccount(mpFetch: MpFetch, token: string, name: string): Promise<MpAccount[]> {
  const json = await mpFetch(SEARCHBIZ, {
    action: 'search_biz', token, lang: 'zh_CN', f: 'json', ajax: '1',
    random: String(Math.random()), query: name, begin: '0', count: '5',
  })
  checkRet(json)
  const list = (json.list as Record<string, unknown>[]) ?? []
  return list.map((a) => ({
    fakeid: String(a.fakeid ?? ''),
    nickname: String(a.nickname ?? ''),
    alias: String(a.alias ?? ''),
    signature: String(a.signature ?? ''),
  }))
}

export interface ListOpts { sleep?: (ms: number) => Promise<void> }

async function fetchPage(
  mpFetch: MpFetch, token: string, fakeid: string, begin: number,
): Promise<{ items: ArticleRef[]; total: number }> {
  const json = await mpFetch(APPMSG, {
    action: 'list_ex', begin: String(begin), count: String(PAGE), fakeid,
    token, lang: 'zh_CN', f: 'json', ajax: '1', type: '9', query: '',
  })
  checkRet(json)
  const raw = (json.app_msg_list as Record<string, unknown>[]) ?? []
  const items: ArticleRef[] = raw
    .filter((i) => i.link)
    .map((i) => ({ url: String(i.link), title: String(i.title ?? ''), createTime: Number(i.create_time ?? 0) }))
  return { items, total: Number(json.app_msg_cnt ?? 0) }
}

export async function listArticles(
  mpFetch: MpFetch, token: string, fakeid: string, range: CrawlRange, opts: ListOpts = {},
): Promise<ArticleRef[]> {
  const sleepFn = opts.sleep ?? sleep
  const out: ArticleRef[] = []
  let begin = 0
  for (;;) {
    if (begin > 0) await sleepFn(randMs(1000, 3000))
    const { items, total } = await fetchPage(mpFetch, token, fakeid, begin)
    if (!items.length) break
    if ('count' in range) {
      out.push(...items)
      if (out.length >= range.count) return out.slice(0, range.count)
    } else {
      const fromTs = Date.parse(`${range.from}T00:00:00`) / 1000
      const toTs = Date.parse(`${range.to}T23:59:59`) / 1000
      for (const it of items) {
        if (it.createTime > toTs) continue
        if (it.createTime < fromTs) return out
        out.push(it)
      }
    }
    begin += PAGE
    if (begin >= total) break
  }
  return out
}
