// src/core/mp-client.ts
import type { MpFetch, MpAccount, ArticleRef, CrawlRange, MpJson } from './mp-types'
import { MpRateLimited, MpAuthExpired, MpApiError } from './mp-errors'

const SEARCHBIZ = 'https://mp.weixin.qq.com/cgi-bin/searchbiz'
/**
 * 图文素材列表。**已知限制:只返回 `item_show_type=0` 的图文**——文字消息(10)与
 * 视频消息(5)不进列表(它们在「已发表」`appmsgpublish` 接口里,但那个接口每页 20 组、
 * 返回数据多,频控压力更大)。2026-08(M44):换用 appmsgpublish 后约一天即触发账号级
 * 频控(200013),探针证实两端口同 ret、与端点无关——换回 appmsg 并不能解封,但 appmsg
 * 每页实回 ~5 条、更轻,解封后更不易再触发。代价是文字/视频消息的列表覆盖丢失
 * (单篇仍可经 URL 下载,只是不在批量列表里;消息类型在下载阶段从文章 HTML 重读,不丢)。
 */
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

export interface ListOpts {
  sleep?: (ms: number) => Promise<void>
}

/** app_msg_list 里一项(图文素材记录)。只取我们用得着的字段,其余忽略。 */
interface AppMsgItem {
  link?: string; title?: string; create_time?: number
  item_show_type?: number; appmsgid?: number; itemidx?: number
}

/**
 * 拉一页图文素材。返回扁平的 `app_msg_list[]`,每项是一篇文章。
 * **pageLen = 原始返回条数**(含无链接项);begin 是原始列表偏移,必须按它推进。
 * 微信实际每页常少于请求的 count(实测 ~5),按固定步长推进会跳内容(见 listArticles 注释)。
 *
 * 「读者不可访问」(审核未通过/已删除/违规)的文章**不在这里预过滤**:appmsg 的字段语义
 * 不保证与 appmsgpublish 一致,且 v0.8.3 的结论是「误滤代价高于明确失败」——交给下载阶段
 * 的 `ArticleUnavailableError` 从错误页认出来,汇总里把「不可见」与「真故障」分开。
 */
async function fetchPage(
  mpFetch: MpFetch, token: string, fakeid: string, begin: number,
): Promise<{ items: ArticleRef[]; total: number; pageLen: number }> {
  const json = await mpFetch(APPMSG, {
    action: 'list_ex', begin: String(begin), count: String(PAGE), fakeid,
    token, lang: 'zh_CN', f: 'json', ajax: '1', type: '9', query: '',
  })
  checkRet(json)
  const raw = (json.app_msg_list as AppMsgItem[]) ?? []
  const items: ArticleRef[] = raw
    .filter((i) => i.link)
    .map((i) => ({
      url: String(i.link), title: String(i.title ?? ''), createTime: Number(i.create_time ?? 0),
      ...(i.item_show_type != null ? { itemShowType: Number(i.item_show_type) } : {}),
      ...(i.appmsgid != null ? { appmsgid: Number(i.appmsgid) } : {}),
      ...(i.itemidx != null ? { itemidx: Number(i.itemidx) } : {}),
    }))
  return { items, total: Number(json.app_msg_cnt ?? 0), pageLen: raw.length }
}

/**
 * 订阅检查专用:从最新往回翻,直到看见 ≤sinceTs 的已读文章为止,封顶 cap 篇。
 * 日常(水位就在第一页内)恒 1 次请求;空窗多日后整页全新才继续翻深,不漏文章。
 * 微信每页实回 ~5 条,故「翻到水位为止」要按实际返回篇数推进游标。
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
    // 游标必须按「本页实际返回的篇数」推进:微信每页实回常少于请求的 count(~5),
    // 按固定步长(如 count=20)推进会跳过中间文章(曾导致日期范围/最近 N 篇漏抓,见 mp-client.test)。
    begin += pageLen
    if (begin >= total) break
  }
  return out
}
