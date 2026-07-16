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
): Promise<{ items: ArticleRef[]; total: number; pageLen: number }> {
  const json = await mpFetch(APPMSG, {
    action: 'list_ex', begin: String(begin), count: String(PAGE), fakeid,
    token, lang: 'zh_CN', f: 'json', ajax: '1', type: '9', query: '',
  })
  checkRet(json)
  const raw = (json.app_msg_list as Record<string, unknown>[]) ?? []
  const items: ArticleRef[] = raw
    .filter((i) => i.link)
    .map((i) => ({ url: String(i.link), title: String(i.title ?? ''), createTime: Number(i.create_time ?? 0) }))
  // pageLen = 原始返回条数（含无链接项）；begin 是原始列表偏移，必须按它推进。
  return { items, total: Number(json.app_msg_cnt ?? 0), pageLen: raw.length }
}

/**
 * 订阅检查专用:从最新往回翻,直到看见 ≤sinceTs 的已读文章为止,封顶 cap 篇。
 * 日常(水位就在第一页内)恒 1 次请求——微信每页实回 ~5 篇,固定取 20 要翻 4 页,
 * 对「日更最多一篇」的订阅号是纯浪费;空窗多日后整页全新才继续翻深,不漏文章。
 * 返回值含扫到的旧文章,新旧判定留给调用方(checkSubscriptions 按水位过滤)。
 */
export async function listArticlesSince(
  mpFetch: MpFetch, token: string, fakeid: string, sinceTs: number, opts: ListOpts = {}, cap = 20,
): Promise<ArticleRef[]> {
  const sleepFn = opts.sleep ?? sleep
  const out: ArticleRef[] = []
  let begin = 0
  for (;;) {
    if (begin > 0) await sleepFn(randMs(1000, 3000))
    const { items, total, pageLen } = await fetchPage(mpFetch, token, fakeid, begin)
    if (!pageLen) break
    out.push(...items)
    if (items.some((i) => i.createTime <= sinceTs)) break   // 已翻到水位(本页含已读)
    if (out.length >= cap) break
    begin += pageLen
    if (begin >= total) break
  }
  return out
}

export async function listArticles(
  mpFetch: MpFetch, token: string, fakeid: string, range: CrawlRange, opts: ListOpts = {},
): Promise<ArticleRef[]> {
  const sleepFn = opts.sleep ?? sleep
  const out: ArticleRef[] = []
  let begin = 0
  for (;;) {
    if (begin > 0) await sleepFn(randMs(1000, 3000))
    const { items, total, pageLen } = await fetchPage(mpFetch, token, fakeid, begin)
    if (!pageLen) break   // 这一页原始为空 = 没有更多文章
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
    // 微信实际每页常少于请求的 count（实测 5）；游标必须按「原始返回篇数」推进，
    // 否则按固定步长会跳过中间文章（曾导致日期范围/最近 N 篇漏抓，见 mp-client.test）。
    begin += pageLen
    if (begin >= total) break
  }
  return out
}
