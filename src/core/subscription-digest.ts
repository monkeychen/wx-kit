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
  /** 文章目录(在本地才有)。**刚下的与本来就有的形状一致**——agent 不必合并两种结果 */
  dir?: string
  /** 正文文件。**只在它真的存在时才给**(下载时选了 md);给一个不存在的路径比不给更糟 */
  contentPath?: string
  /** 解析/下载期的告警:「下到了但可能不对」的唯一信号 */
  warnings?: string[]
  /** 下载失败的原因(条目仍留在清单里,可重试) */
  error?: string
  /** 失败是「读者本就打不开」(审核未通过/已删除/违规下架)——**重试无用**,别让 agent 死磕 */
  unavailable?: boolean
}

/** 一篇文章在本地的落点;`contentPath` 缺省表示没有正文文件(下载时没选 md) */
export interface LocalArticle { dir: string; contentPath?: string; warnings?: string[] }

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
   * 这篇在本地的落点,不在库里返回 null。**同时给 id 与 url**:老库里有一批文章的 id 是路径哈希
   * (v0.8.4 前订阅下载没透传文章主键),光比 id 会把它们误判成「没下载」。
   * 回路径而不只回 boolean:本来就是同一次查库,顺手把「在哪」也答了(v0.8.5 R1)。
   */
  localOf: (id: string, url: string) => Promise<LocalArticle | null>
  onProgress?: (e: { index: number; total: number; nickname: string; count: number }) => void
}

const idOf = (r: ArticleRef) =>
  r.appmsgid != null && r.itemidx != null ? `${r.appmsgid}_${r.itemidx}` : r.url

export async function subscriptionDigest(deps: DigestDeps): Promise<DigestResult> {
  const { accounts, date, listByDate, localOf, onProgress } = deps
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
      const local = await localOf(id, r.url)
      articles.push({
        account: acc.nickname,
        title: r.title,
        publishTime: new Date(r.createTime * 1000).toISOString(),
        url: r.url,
        ...(r.itemShowType != null ? { itemShowType: r.itemShowType } : {}),
        downloaded: local != null,
        id,
        ...(local?.dir ? { dir: local.dir } : {}),
        ...(local?.contentPath ? { contentPath: local.contentPath } : {}),
        ...(local?.warnings?.length ? { warnings: local.warnings } : {}),
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

export interface FetchMissingDeps {
  /** 下一篇。串行调用(频控纪律);实现方负责判重与库写入 */
  download: (url: string, hint: { appmsgid?: number; itemidx?: number }) => Promise<{
    ok: boolean; dir?: string; warnings?: string[]; error?: string; unavailable?: boolean
  }>
  /** 由 dir 推出正文路径。**不传表示这次下载不产出正文文件**(formats 里没有 md) */
  contentPathOf?: (dir: string) => string
  onProgress?: (e: { index: number; total: number; title: string }) => void
}

/**
 * 把清单里还没下载的那几篇取回来,返回**新的**清单(不原地改)。
 *
 * 与 `subscriptionDigest` 分成两个函数而不是加一个开关:
 * **「不带 --download 时行为一字不变」由结构保证,而不是靠一个 if 分支的自觉**。
 *
 * 关键点是**输出形状统一**:刚下的与本来就有的都带 `dir`(以及有正文时的 `contentPath`),
 * 调用方不必合并两种结果——这正是 v0.8.5 R1 要解决的那道缝。
 */
export async function fetchMissing(
  articles: DigestArticle[], deps: FetchMissingDeps,
): Promise<DigestArticle[]> {
  const pending = articles.filter((a) => !a.downloaded)
  if (!pending.length) return articles.map((a) => ({ ...a }))

  const done = new Map<string, DigestArticle>()
  let i = 0
  for (const a of pending) {
    deps.onProgress?.({ index: ++i, total: pending.length, title: a.title })
    const [mid, idx] = a.id.split('_')
    const hint = /^\d+$/.test(mid) && /^\d+$/.test(idx ?? '')
      ? { appmsgid: Number(mid), itemidx: Number(idx) }
      : {}
    const r = await deps.download(a.url, hint)
    const warnings = [...(a.warnings ?? []), ...(r.warnings ?? [])]
    done.set(a.id, {
      ...a,
      downloaded: r.ok,
      ...(r.ok && r.dir ? { dir: r.dir } : {}),
      ...(r.ok && r.dir && deps.contentPathOf ? { contentPath: deps.contentPathOf(r.dir) } : {}),
      ...(warnings.length ? { warnings } : {}),
      // 失败留痕:条目不消失,agent 能看出「这篇没拿到、为什么、可不可以再试」
      ...(r.ok ? {} : { error: r.error ?? '下载失败' }),
      ...(r.unavailable ? { unavailable: true } : {}),
    })
  }
  return articles.map((a) => done.get(a.id) ?? { ...a })
}
