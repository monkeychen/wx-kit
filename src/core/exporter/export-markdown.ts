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

// turndown 内核不支持表格（GFM 扩展语法），遇到 <table> 会退化成逐单元格取文本、行列关系全丢。
// 这里自写规则而不引 turndown-plugin-gfm：微信的单元格内容包着 <section>，插件会把它当块级元素
// 处理、炸出裸换行 → 非法 GFM，修它等于把插件核心重写一遍，不如直接自己来（见 M29 计划）。
const flattenCell = (el: Element): string =>
  td.turndown(el.innerHTML)
    .replace(/\s+/g, ' ')      // 块级元素留下的换行/缩进一律压成单空格（GFM 表格不允许裸换行）
    .replace(/\|/g, '\\|')     // 管道符会被当列分隔符
    .trim()

const cellsOf = (row: Element): Element[] =>
  Array.from(row.children).filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH')

td.addRule('gfmTable', {
  filter: 'table',
  replacement: (_content, node) => {
    const rows = Array.from((node as unknown as Element).getElementsByTagName('tr'))
    if (rows.length === 0) return ''
    // 无 <thead> 时以首行为表头——GFM 表格必须有表头行
    const [head, ...body] = rows
    const headCells = cellsOf(head).map(flattenCell)
    if (headCells.length === 0) return ''
    const line = (cells: string[]) =>
      `| ${Array.from({ length: headCells.length }, (_, i) => cells[i] ?? '').join(' | ')} |`
    return [
      '',
      line(headCells),
      `| ${headCells.map(() => '---').join(' | ')} |`,
      ...body.map((r) => line(cellsOf(r).map(flattenCell))),
      '',
    ].join('\n')
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
