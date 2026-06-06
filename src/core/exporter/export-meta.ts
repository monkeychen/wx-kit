// src/core/exporter/export-meta.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArticleMeta, DownloadFormat, ParsedArticle } from '../types'

export interface BuildMetaInput {
  parsed: ParsedArticle
  id: string
  sourceUrl: string
  dir: string
  formats: DownloadFormat[]
  now: string
}

export function buildMeta(input: BuildMetaInput): ArticleMeta {
  const { parsed, id, sourceUrl, dir, formats, now } = input
  return {
    id,
    title: parsed.title,
    author: parsed.author,
    account: parsed.account,
    publishTime: parsed.publishTime,
    sourceUrl,
    digest: parsed.digest,
    coverUrl: parsed.coverUrl,
    downloadTime: now,
    formats,
    dir,
  }
}

export async function writeMeta(dir: string, meta: ArticleMeta): Promise<void> {
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
}
