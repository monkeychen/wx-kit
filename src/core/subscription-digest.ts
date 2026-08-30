// 日报只读取文库元数据；刷新和下载由独立编排执行，不能把检查时刻当作发表时间。
import type { ArticleMeta } from './types'
import { parsePublicationTime, shanghaiDate } from './publication-time'
import { normalizeAccountId } from './weread/book-id'

export interface DigestAccount { fakeid: string; nickname: string }
export interface DigestArticle {
  account: string
  title: string
  publishTime: string
  url: string
  itemShowType?: number
  downloaded: boolean
  id: string
  dir?: string
  contentPath?: string
  warnings?: string[]
}
export interface DigestFailure {
  nickname: string
  error: string
  fakeid?: string
  url?: string
  code?: string
  unavailable?: boolean
}
export interface DigestResult {
  ok: boolean
  date: string
  accounts: number
  count: number
  articles: DigestArticle[]
  unknownPublishTimeCount: number
  coverageNote: string
  warnings?: string[]
  failures?: DigestFailure[]
}
export interface DigestDeps {
  accounts: DigestAccount[]
  date: string
  library: ArticleMeta[]
  /** 调用方检查真实文件存在后才返回路径。 */
  contentPathOf?: (article: ArticleMeta) => string | undefined
}

function belongsToAccount(article: ArticleMeta, accounts: DigestAccount[]): boolean {
  // 长链自带公众号身份时优先使用；短链旧元数据只能与本地订阅昵称精确匹配。
  try {
    const biz = article.accountId || new URL(article.sourceUrl).searchParams.get('__biz')
    if (biz) return accounts.some((a) => normalizeAccountId(a.fakeid) === normalizeAccountId(biz))
  } catch { /* 老数据缺少可解析身份时用本地昵称 */ }
  return accounts.some((a) => a.nickname === article.account)
}

export function subscriptionDigest(deps: DigestDeps): DigestResult {
  const articles: DigestArticle[] = []
  let unknownPublishTimeCount = 0
  for (const article of deps.library) {
    if (!belongsToAccount(article, deps.accounts)) continue
    const time = parsePublicationTime(article.publishTime)
    if (time == null) { unknownPublishTimeCount++; continue }
    if (shanghaiDate(time) !== deps.date) continue
    const contentPath = deps.contentPathOf?.(article)
    articles.push({
      id: article.id, account: article.account, title: article.title,
      publishTime: new Date(time).toISOString(), url: article.sourceUrl,
      downloaded: true, dir: article.dir,
      ...(contentPath ? { contentPath } : {}),
      ...(article.itemShowType != null ? { itemShowType: article.itemShowType } : {}),
      ...(article.warnings?.length ? { warnings: article.warnings } : {}),
    })
  }
  articles.sort((a, b) => b.publishTime.localeCompare(a.publishTime))
  return {
    ok: true, date: deps.date, accounts: deps.accounts.length,
    count: articles.length, articles, unknownPublishTimeCount,
    coverageNote: '清单仅覆盖本地已保存文章；每号只能获取刷新时最新一篇，两次刷新间被覆盖的文章可能漏检。',
    ...(unknownPublishTimeCount ? {
      warnings: [`所选账号另有 ${unknownPublishTimeCount} 篇文库文章无法确定发表日期，未归入任何日期清单；这不是当天漏文数量。`],
    } : {}),
  }
}
