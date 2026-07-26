// src/core/exporter/index.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArticleMeta, DownloadFormat, ParsedArticle } from '../types'
import { buildMeta, writeMeta } from './export-meta'
import { writeMarkdown } from './export-markdown'
import { writeHtml } from './export-html'
import { writeCover } from './export-cover'
import { writePdfFromHtml } from './export-pdf'
import { buildImageMap, rewriteImageRefs } from '../image-localizer'
import { downloadVideos } from './export-video'

export interface ExportDeps {
  /** 下载二进制（图片/封面） */
  fetchBinary: (url: string) => Promise<{ data: Buffer; contentType: string }>
  /** Electron BrowserWindow 构造器（PDF 用）；CLI/GUI 注入 */
  BrowserWindowCtor: typeof import('electron').BrowserWindow
  now: () => string
  /** 视频下载进度（单个可达上百 MB，不给反馈会像卡死） */
  onVideoProgress?: (e: { index: number; total: number; video: import('../parse-video').MpVideoSource }) => void
  /** 非致命问题的上报（如视频下载失败）：文章其余部分照常产出，但用户不该靠翻文件才发现 */
  onWarning?: (message: string) => void
}

export interface ExportInput {
  parsed: ParsedArticle
  id: string
  sourceUrl: string
  dir: string
  formats: DownloadFormat[]
  /** 是否下载文中视频（内容的一部分，不是格式）。缺省视为 true。 */
  downloadVideos?: boolean
}

/** 按所选格式导出一篇文章，返回最终 meta。调用方保证 dir 尚不存在或可写。 */
export async function exportArticle(input: ExportInput, deps: ExportDeps): Promise<ArticleMeta> {
  const { parsed, id, sourceUrl, dir, formats, downloadVideos: wantVideo = true } = input
  await mkdir(dir, { recursive: true })

  const needImages = formats.includes('md') || formats.includes('html') || formats.includes('pdf')
  let contentHtml = parsed.contentHtml

  // 图片本地化（md/html/pdf 需要）
  if (needImages && parsed.imageUrls.length) {
    const downloaded = new Map<string, { data: Buffer; contentType: string }>()
    for (const url of parsed.imageUrls) {
      try { downloaded.set(url, await deps.fetchBinary(url)) } catch { /* 跳过坏图 */ }
    }
    if (downloaded.size) {
      await mkdir(join(dir, 'images'), { recursive: true })
      const map = buildImageMap([...downloaded.keys()], u => downloaded.get(u)!.contentType)
      for (const [url, rel] of map) await writeFile(join(dir, rel), downloaded.get(url)!.data)
      contentHtml = rewriteImageRefs(parsed.contentHtml, map)
    }
    // Strip any remaining data-src attributes (failed downloads leave remote URLs)
    contentHtml = contentHtml.replace(/ data-src="[^"]*"/g, '')
  }

  const meta = buildMeta({ parsed, id, sourceUrl, dir, formats, now: deps.now() })

  if (formats.includes('cover') && parsed.coverUrl) {
    try { const { data, contentType } = await deps.fetchBinary(parsed.coverUrl); await writeCover(dir, data, contentType) } catch { /* 封面失败不致命 */ }
  }

  // 视频：必须在写 md/html 之前（正文要引用它），且必须在本次流程内下完
  // ——直链带 auth_key/dis_t 签名有时效，存下来隔次再下必然失效。
  const { records: videoRecords, htmlSuffix, mdSuffix, warnings } = await downloadVideos(
    parsed.videos, dir, wantVideo, deps.fetchBinary, deps.onVideoProgress,
  )
  if (videoRecords.length) meta.videos = videoRecords
  for (const w of warnings) deps.onWarning?.(w)

  // html 与 md 的视频引用形态不同（html 能内联 <video>，md 只能给链接），
  // 且 turndown 不认识 <video> —— 所以分成两个 suffix，不能共用一份 contentHtml。
  const htmlBody = htmlSuffix ? `${contentHtml}\n${htmlSuffix}` : contentHtml

  if (formats.includes('md')) await writeMarkdown(dir, meta, contentHtml, mdSuffix)
  // pdf renders from index.html, so html is written when pdf is requested even
  // if 'html' wasn't selected; index.html then remains as an intermediate file.
  if (formats.includes('html') || formats.includes('pdf')) await writeHtml(dir, meta, htmlBody)
  if (formats.includes('pdf')) await writePdfFromHtml(dir, deps.BrowserWindowCtor)
  if (formats.includes('meta')) await writeMeta(dir, meta)

  return meta
}
