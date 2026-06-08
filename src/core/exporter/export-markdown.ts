// src/core/exporter/export-markdown.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import TurndownService from 'turndown'
import type { ArticleMeta } from '../types'

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

// 微信代码块把每一行单独包成一个 <code>（<pre><code>行1</code><code>行2</code>…</pre>），
// turndown 默认的 fencedCodeBlock 规则只取第一个 <code> → 会静默丢掉除首行外的全部正文。
// 这条规则把所有 <code> 行的纯文本拼回来，按 data-lang 标注语言。
td.addRule('wechatCodeSnippet', {
  filter: (node) =>
    node.nodeName === 'PRE' &&
    (node as unknown as Element).getElementsByTagName('code').length > 1,
  replacement: (_content, node) => {
    const el = node as unknown as Element
    const lang = el.getAttribute('data-lang') ?? ''
    const lines = Array.from(el.getElementsByTagName('code')).map((c) => c.textContent ?? '')
    return `\n\n\`\`\`${lang}\n${lines.join('\n')}\n\`\`\`\n\n`
  },
})

function frontmatter(m: ArticleMeta): string {
  const esc = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
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
