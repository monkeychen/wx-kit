// src/core/mp-client.ts
import type { MpFetch, MpAccount, ArticleRef, CrawlRange, MpJson } from './mp-types'
import { MpRateLimited, MpAuthExpired, MpApiError } from './mp-errors'

const SEARCHBIZ = 'https://mp.weixin.qq.com/cgi-bin/searchbiz'
/**
 * 「已发表」列表。**不要换回 `cgi-bin/appmsg?type=9`** —— 那个拉的是「图文素材」,
 * 只返回 item_show_type=0 的图文:实测某号 appmsg 给 370 篇、最新卡在 2026-07-17,
 * 而本接口给 770 篇、最新 2026-07-25,文字消息(10)与视频消息(5)全在里面。
 * 旧接口没有「取全部类型」的开关(type 换任何值都 ret=200002),只能换接口。
 * 后果不只是批量抓取少几篇:订阅检查共用这条链路,曾长期静默漏检整类消息。
 */
const APPMSG_PUBLISH = 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish'
const PAGE = 20

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
  /**
   * 上报被过滤掉的「读者不可访问」篇数。做成回调而不是改返回类型:
   * `listArticles` 的返回值被 crawl/ipc/cli 多处消费,改签名波及面大。
   */
  onHidden?: (n: number) => void
}

/** 中间两层是 JSON 字符串;脏数据不该炸掉整次抓取,解析失败按空处理 */
function parseJsonSafe<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null
  try { return JSON.parse(raw) as T } catch { return null }
}

interface PublishGroup { publish_info?: string }
interface PublishPage { total_count?: number; publish_list?: PublishGroup[] }
interface AppMsgEx {
  link?: string; title?: string; create_time?: number
  item_show_type?: number; itemidx?: number; is_deleted?: boolean
  appmsgid?: number
  checking?: number; ban_flag?: number
}

/**
 * 读者能否打开这篇文章。三个字段都来自后台列表,含义各不相同:
 *   `is_deleted` —— 作者自己删了
 *   `checking`   —— 审核不通过(**终态**,不是「审核中」;页面显示「此内容发送失败无法查看…涉嫌违规」)
 *   `ban_flag`   —— 封禁标记(未见真实样本,按字面处理:非 0 即不可见)
 *
 * 这三种文章的页面都打不开(返回微信的错误页),列进结果只会产生**必然失败**的下载,
 * 而且失败原因会退化成笼统的「no title parsed」——信号在列表里就有,不该拖到下载时才发现。
 */
function isReaderVisible(a: AppMsgEx): boolean {
  return !a.is_deleted && !a.checking && !a.ban_flag
}

/**
 * 拉一页「已发表」记录。
 * 结构:`publish_page`(JSON 串)→ `publish_list[]` → 每组的 `publish_info`(JSON 串)→ `appmsgex[]`。
 * **begin/count 按「群发组」计,不是文章数**——一次群发多篇时一组含多项,
 * 故 pageLen 返回组数;按文章数推进游标会整组跳过(旧接口踩过同类坑,见下方 listArticles 注释)。
 */
async function fetchPage(
  mpFetch: MpFetch, token: string, fakeid: string, begin: number,
): Promise<{ items: ArticleRef[]; total: number; pageLen: number; hidden: number }> {
  const json = await mpFetch(APPMSG_PUBLISH, {
    sub: 'list', sub_action: 'list_ex', begin: String(begin), count: String(PAGE), fakeid,
    type: '101_1', free_publish_type: '1', search_field: 'null', query: '',
    token, lang: 'zh_CN', f: 'json', ajax: '1',
  })
  checkRet(json)
  const page = parseJsonSafe<PublishPage>((json as Record<string, unknown>).publish_page)
  const groups = page?.publish_list ?? []
  const items: ArticleRef[] = []
  let hidden = 0
  for (const g of groups) {
    const info = parseJsonSafe<{ appmsgex?: AppMsgEx[] }>(g.publish_info)
    for (const a of info?.appmsgex ?? []) {
      if (!a.link) continue
      if (!isReaderVisible(a)) { hidden++; continue }
      items.push({
        url: String(a.link), title: String(a.title ?? ''), createTime: Number(a.create_time ?? 0),
        ...(a.item_show_type != null ? { itemShowType: Number(a.item_show_type) } : {}),
        // 去重要用:本接口给短链,认不出与长链是同一篇,得靠 mid/idx
        ...(a.appmsgid != null ? { appmsgid: Number(a.appmsgid) } : {}),
        ...(a.itemidx != null ? { itemidx: Number(a.itemidx) } : {}),
      })
    }
  }
  return { items, total: Number(page?.total_count ?? 0), pageLen: groups.length, hidden }
}

/**
 * 订阅检查专用:从最新往回翻,直到看见 ≤sinceTs 的已读文章为止,封顶 cap 篇。
 * 日常(水位就在第一页内)恒 1 次请求;空窗多日后整页全新才继续翻深,不漏文章。
 * (M36 前的旧接口每页实回 ~5 条,这条「翻到水位为止」的逻辑正是为它做的补偿;
 *  换 appmsgpublish 后每页 20 组,一次请求覆盖更深,逻辑不变但触发翻页的机会少多了。)
 * 返回值含扫到的旧文章,新旧判定留给调用方(checkSubscriptions 按水位过滤)。
 */
export async function listArticlesSince(
  mpFetch: MpFetch, token: string, fakeid: string, sinceTs: number, opts: ListOpts = {}, cap = 20,
): Promise<ArticleRef[]> {
  const out: ArticleRef[] = []
  let begin = 0
  for (;;) {
    const { items, total, pageLen, hidden } = await fetchPage(mpFetch, token, fakeid, begin)
    if (hidden) opts.onHidden?.(hidden)
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
  const out: ArticleRef[] = []
  let begin = 0
  for (;;) {
    const { items, total, pageLen, hidden } = await fetchPage(mpFetch, token, fakeid, begin)
    if (hidden) opts.onHidden?.(hidden)
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
    // 游标必须按「本页实际返回的组数」推进：微信常少于请求的 count，
    // 且一组可能含多篇；按固定步长或按文章数推进都会跳内容（见 mp-client.test）。
    begin += pageLen
    if (begin >= total) break
  }
  return out
}
