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

export interface ExportDeps {
  /** 下载二进制（图片/封面） */
  fetchBinary: (url: string) => Promise<{ data: Buffer; contentType: string }>
  /** Electron BrowserWindow 构造器（PDF 用）；CLI/GUI 注入 */
  BrowserWindowCtor: typeof import('electron').BrowserWindow
  now: () => string
}

export interface ExportInput {
  parsed: ParsedArticle
  id: string
  sourceUrl: string
  dir: string
  formats: DownloadFormat[]
}

/** 按所选格式导出一篇文章，返回最终 meta。调用方保证 dir 尚不存在或可写。 */
export async function exportArticle(input: ExportInput, deps: ExportDeps): Promise<ArticleMeta> {
  const { parsed, id, sourceUrl, dir, formats } = input
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
  if (formats.includes('md')) await writeMarkdown(dir, meta, contentHtml)
  // pdf renders from index.html, so html is written when pdf is requested even
  // if 'html' wasn't selected; index.html then remains as an intermediate file.
  if (formats.includes('html') || formats.includes('pdf')) await writeHtml(dir, meta, contentHtml)
  if (formats.includes('pdf')) await writePdfFromHtml(dir, deps.BrowserWindowCtor)
  if (formats.includes('meta')) await writeMeta(dir, meta)

  return meta
}
