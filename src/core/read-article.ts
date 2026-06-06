// src/core/read-article.ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ReadableKind = 'md' | 'html'

const FILE_BY_KIND: Record<ReadableKind, string> = { md: 'content.md', html: 'index.html' }

/** 读取文章正文。md 去除 YAML frontmatter（开头 --- ... --- 块）。 */
export async function readArticleContent(dir: string, kind: ReadableKind): Promise<string> {
  const file = join(dir, FILE_BY_KIND[kind])
  let text: string
  try {
    text = await readFile(file, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${kind} content not found in ${dir}`)
    }
    throw err
  }
  if (kind === 'md') {
    const normalised = text.replace(/\r\n/g, '\n')
    const m = normalised.match(/^---\n[\s\S]*?\n---\n/)
    if (m) text = normalised.slice(m[0].length)
    else text = normalised
  }
  return text
}
