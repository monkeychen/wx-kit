// src/core/download-article.ts
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { DownloadFormat, DownloadItemResult } from './types'
import { articleId, type ArticleIdHint } from './article-id'
import { articleDirName, dedupeDirName, sanitizeName } from './paths'
import { parseArticle } from './parse-article'
import { extractArticleKeys } from './article-keys'
import { exportArticle, type ExportDeps } from './exporter'
import { Library } from './library'
import { parsePublicationTime } from './publication-time'
import { globalRequestStopCode } from './mp-errors'
import { normalizeAccountId } from './weread/book-id'

export interface DownloadArticleDeps extends ExportDeps {
  fetchHtml: (url: string) => Promise<string>
  library: Library
  libraryRoot: string
  /** 是否下载文中视频（设置项，默认 true）。视频是内容不是格式，故不走 formats。 */
  downloadVideos?: boolean
  accountId?: string
  onProgress?: (stage: { phase: import('./types').ProgressPhase; message?: string }) => void
}

/**
 * 文章本身读者就打不开(审核未通过 / 已删除 / 违规下架),**不是下载故障**。
 * 分成独立类型是因为两者对用户的含义完全不同:重试一百次也没用,
 * 而把它混进 failed 会让人以为工具坏了。列表接口在文章被拒后不再有任何标记
 * (`checking` 只在审核期间为 1,审核完就归零),所以只能在这一步认出来。
 */
export class ArticleUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'ArticleUnavailableError' }
}

/** 从微信的错误页里认出「为什么打不开」；认不出就退回原来的笼统说法 */
export function describeUnavailable(html: string): { unavailable: boolean; message: string } {
  if (html.includes('此内容发送失败无法查看')) return { unavailable: true, message: '该文章审核未通过，读者不可见（无法下载）' }
  if (html.includes('已被发布者删除')) return { unavailable: true, message: '该文章已被作者删除（无法下载）' }
  if (html.includes('内容违规') || html.includes('涉嫌违规')) return { unavailable: true, message: '该文章因违规被下架，读者不可见（无法下载）' }
  // 认不出就别硬猜是「不可见」——可能真是解析出了问题，那属于故障
  return { unavailable: false, message: 'invalid or unavailable article (no title parsed)' }
}

export async function downloadArticle(
  url: string,
  formats: DownloadFormat[],
  deps: DownloadArticleDeps,
  /** 列表给的文章主键；缺省时只能从 URL 推断（短链推不出，见 articleId） */
  hint?: ArticleIdHint,
): Promise<DownloadItemResult> {
  let id = articleId(url, hint)
  if (await deps.library.has(id)) {
    const existing = await deps.library.get(id)
    return { url, ok: true, id, skipped: true, title: existing?.title, dir: existing?.dir }
  }

  deps.onProgress?.({ phase: 'fetch', message: '获取正文' })
  let html = await deps.fetchHtml(url)
  let parsed = parseArticle(html, url)
  if (!parsed.title.trim() && url.includes('/s/')) {
    const altUrl = url.includes('~') ? url.replace(/~/g, '_') : url.includes('_') ? url.replace(/_/g, '~') : url
    if (altUrl !== url) {
      try {
        const altHtml = await deps.fetchHtml(altUrl)
        const altParsed = parseArticle(altHtml, altUrl)
        if (altParsed.title.trim()) {
          html = altHtml
          parsed = altParsed
          url = altUrl
          // 粘贴的是短链且无 hint 时 id 是 URL 哈希，需按新 URL 重算
          if (id.startsWith('h_')) id = articleId(url, hint)
        }
      } catch (error) {
        if (globalRequestStopCode(error)) throw error
        // 普通换 token 重取失败仍维持原标题为空的判定。
      }
    }
  }

  // 短链无 hint 时 id 是 URL 哈希（h_ 形态），与列表抓取/长链算出的 mid_idx 认不出同一篇。
  // 页面已到手，顺手从脚本变量补出微信主键再判一次——两条下载路径由此归一。
  // 存量 h_ 条目无法回溯归一（哈希不可逆），属历史限制。
  if (id.startsWith('h_')) {
    const keys = extractArticleKeys(html)
    if (keys.mid && keys.idx) {
      const canonical = `${keys.mid}_${keys.idx}`
      if (await deps.library.has(canonical)) {
        const existing = await deps.library.get(canonical)
        return { url, ok: true, id: canonical, skipped: true, title: existing?.title, dir: existing?.dir }
      }
      id = canonical
    }
  }

  if (!parsed.title.trim()) {
    // 判定逻辑不变（标题为空仍是手动粘链接时的唯一防线），但把原因说准:
    // 微信对下架/违规文章返回 HTTP 200 的错误页，页面上写着具体缘由，
    // 笼统地报「no title parsed」等于让用户去猜自己粘的链接哪里不对。
    const { unavailable, message } = describeUnavailable(html)
    throw unavailable
      ? new ArticleUnavailableError(`${message}: ${url}`)
      : new Error(`${message}: ${url}`)
  }

  if (parsePublicationTime(parsed.publishTime) == null) {
    parsed.warnings.push('未解析到有效发表时间，正文已保存；该文章暂不归入按发表日期查询的日报。')
  }
  const accountDir = join(deps.libraryRoot, sanitizeName(parsed.account || 'unknown'))
  const datePrefix = parsed.publishTime.slice(0, 10)
  const base = articleDirName(datePrefix, parsed.title)
  const dirName = dedupeDirName(base, name => existsSync(join(accountDir, name)))
  const dir = join(accountDir, dirName)

  // 视频这类非致命失败要浮到调用方（CLI JSON / GUI 结果区），否则只剩 ok:true 在误导
  const warnings: string[] = []
  let accountId: string | undefined
  const rawAccountId = deps.accountId ?? extractArticleKeys(html).biz
  if (rawAccountId) {
    try { accountId = normalizeAccountId(rawAccountId) } catch { /* 无可靠身份时仍保存正文 */ }
  }
  deps.onProgress?.({ phase: 'export', message: '生成文件' })
  const meta = await exportArticle({ parsed, id, sourceUrl: url, dir, formats, downloadVideos: deps.downloadVideos, accountId },
    { ...deps, onWarning: (m) => { warnings.push(m); deps.onWarning?.(m) } })
  await deps.library.add(meta)

  return { url, ok: true, id, dir, formats: meta.formats, title: meta.title, ...(warnings.length ? { warnings } : {}) }
}
