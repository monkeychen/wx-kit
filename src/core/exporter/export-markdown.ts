// src/core/exporter/export-markdown.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import TurndownService from 'turndown'
import type { ArticleMeta } from '../types'

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

function frontmatter(m: ArticleMeta): string {
  const esc = (s: string) => s.replace(/"/g, '\\"')
  return [
    '---',
    `title: "${esc(m.title)}"`,
    `account: "${esc(m.account)}"`,
    `author: "${esc(m.author)}"`,
    `publishTime: "${esc(m.publishTime)}"`,
    `source: "${esc(m.sourceUrl)}"`,
    `downloadTime: "${m.downloadTime}"`,
    '---',
    '',
  ].join('\n')
}

export function buildMarkdown(meta: ArticleMeta, contentHtml: string): string {
  return frontmatter(meta) + `# ${meta.title}\n\n` + td.turndown(contentHtml) + '\n'
}

export async function writeMarkdown(dir: string, meta: ArticleMeta, contentHtml: string): Promise<void> {
  await writeFile(join(dir, 'content.md'), buildMarkdown(meta, contentHtml), 'utf-8')
}
