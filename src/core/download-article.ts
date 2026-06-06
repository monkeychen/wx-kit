// src/core/download-article.ts
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { DownloadFormat, DownloadItemResult } from './types'
import { articleId } from './article-id'
import { articleDirName, dedupeDirName, sanitizeName } from './paths'
import { parseArticle } from './parse-article'
import { exportArticle, type ExportDeps } from './exporter'
import { Library } from './library'

export interface DownloadArticleDeps extends ExportDeps {
  fetchHtml: (url: string) => Promise<string>
  library: Library
  libraryRoot: string
}

export async function downloadArticle(
  url: string,
  formats: DownloadFormat[],
  deps: DownloadArticleDeps,
): Promise<DownloadItemResult> {
  const id = articleId(url)
  if (await deps.library.has(id)) return { url, ok: true, id, skipped: true }

  const html = await deps.fetchHtml(url)
  const parsed = parseArticle(html, url)

  const accountDir = join(deps.libraryRoot, sanitizeName(parsed.account || 'unknown'))
  const datePrefix = parsed.publishTime.slice(0, 10)
  const base = articleDirName(datePrefix, parsed.title)
  const dirName = dedupeDirName(base, name => existsSync(join(accountDir, name)))
  const dir = join(accountDir, dirName)

  const meta = await exportArticle({ parsed, id, sourceUrl: url, dir, formats }, deps)
  await deps.library.add(meta)

  return { url, ok: true, id, dir, formats: meta.formats }
}
