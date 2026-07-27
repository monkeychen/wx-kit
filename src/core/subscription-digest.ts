// src/core/subscription-digest.ts
// 「某一天各订阅号发了什么」——纯查询,不下载、不写库、不推订阅水位。
//
// 与 `check-now` 的区别不是参数而是**语义**:check-now 是「检查更新」(按水位问「有没有新的」,
// 查完要推水位);digest 是「看看那天有什么」——它可以反复查同一天,不该在订阅状态上留下痕迹。
// 两者共用水位只会互相污染:查一次历史就把「新文章」标记吃掉了。
import type { ArticleRef } from './mp-types'

export interface DigestAccount { fakeid: string; nickname: string }

export interface DigestArticle {
  account: string
  title: string
  /** 发布时间,ISO 8601(本机时区偏移已含在时间戳里) */
  publishTime: string
  url: string
  /** 消息类型:5 视频 / 10 文字 / 8 图片 …… 视频与文字消息没有长正文,当素材的价值不同 */
  itemShowType?: number
  /**
   * 这篇是否已在本地文库。**digest 的价值一半在这个字段**:
   * 它把「发现」与「已有」连起来,agent 拿到清单就知道该 download 还是直接读本地内容。
   */
  downloaded: boolean
  /** 与库内同源的文章 id(mid_idx),agent 可直接拿它对账 */
  id: string
}

export interface DigestFailure { nickname: string; error: string }

export interface DigestResult {
  ok: boolean
  date: string
  accounts: number
  count: number
  articles: DigestArticle[]
  failures?: DigestFailure[]
}

export interface DigestDeps {
  accounts: DigestAccount[]
  date: string
  fromTs: number
  toTs: number
  /** 查某号在 [fromTs, toTs] 内发布的文章。串行调用,内部的频控延迟由 listArticles 负责。 */
  listByDate: (fakeid: string) => Promise<ArticleRef[]>
  /**
   * 这篇是否已在库里。**同时给 id 与 url**:老库里有一批文章的 id 是路径哈希
   * (v0.8.4 前订阅下载没透传文章主键),光比 id 会把它们误判成「没下载」。
   */
  isDownloaded: (id: string, url: string) => Promise<boolean>
  onProgress?: (e: { index: number; total: number; nickname: string; count: number }) => void
}

const idOf = (r: ArticleRef) =>
  r.appmsgid != null && r.itemidx != null ? `${r.appmsgid}_${r.itemidx}` : r.url

export async function subscriptionDigest(deps: DigestDeps): Promise<DigestResult> {
  const { accounts, date, listByDate, isDownloaded, onProgress } = deps
  const articles: DigestArticle[] = []
  const failures: DigestFailure[] = []

  // 串行:并发查多个号会直接撞频控(AGENTS.md 的频控纪律)
  for (const [i, acc] of accounts.entries()) {
    let refs: ArticleRef[] = []
    try {
      refs = await listByDate(acc.fakeid)
    } catch (e) {
      // 某号失败不阻断其余号 —— 部分结果远比「全军覆没」有用
      failures.push({ nickname: acc.nickname, error: (e as Error).message })
      onProgress?.({ index: i + 1, total: accounts.length, nickname: acc.nickname, count: 0 })
      continue
    }
    for (const r of refs) {
      const id = idOf(r)
      articles.push({
        account: acc.nickname,
        title: r.title,
        publishTime: new Date(r.createTime * 1000).toISOString(),
        url: r.url,
        ...(r.itemShowType != null ? { itemShowType: r.itemShowType } : {}),
        downloaded: await isDownloaded(id, r.url),
        id,
      })
    }
    onProgress?.({ index: i + 1, total: accounts.length, nickname: acc.nickname, count: refs.length })
  }

  // 跨号统一按发布时间降序:用户问的是「那天发了什么」,不是「每个号各发了什么」
  articles.sort((a, b) => b.publishTime.localeCompare(a.publishTime))
  // 一个号都没查成不是「部分成功」,是失败 —— 让调用方能给出非 0 退出码
  const ok = failures.length === 0 || failures.length < accounts.length
  return {
    ok, date, accounts: accounts.length, count: articles.length, articles,
    ...(failures.length ? { failures } : {}),
  }
}
