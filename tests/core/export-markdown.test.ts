// tests/core/export-markdown.test.ts
import { describe, it, expect } from 'vitest'
import { buildMarkdown } from '../../src/core/exporter/export-markdown'
import type { ArticleMeta } from '../../src/core/types'

const meta: ArticleMeta = {
  id: '1', title: '标题', author: '公众号', account: '公众号',
  publishTime: '2026-02-25 08:00', sourceUrl: 'https://x/s', digest: '摘要',
  coverUrl: '', downloadTime: '2026-06-06T00:00:00.000Z', formats: ['md'], dir: '/d',
}

describe('buildMarkdown', () => {
  const md = buildMarkdown(meta, '<h2>小标题</h2><p>正文<strong>粗</strong></p><p><img src="images/img-1.jpg" /></p>')

  it('starts with frontmatter containing title and source', () => {
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('title: "标题"')
    expect(md).toContain('source: "https://x/s"')
  })
  it('converts headings and emphasis', () => {
    expect(md).toContain('## 小标题')
    expect(md).toContain('**粗**')
  })
  it('keeps local image reference', () => {
    expect(md).toContain('![](images/img-1.jpg)')
  })
  it('keeps every line of a WeChat multi-<code> code block (not just the first)', () => {
    // 微信代码块把每行单独包成一个 <code>，turndown 默认只取第一行 → 静默丢正文
    const html =
      '<pre class="code-snippet__js" data-lang="markdown">' +
      '<code><span leaf=""># 寓言写作 Prompt</span></code>' +
      '<code><span leaf="">围绕 **{concept}** 写一个寓言故事</span></code>' +
      '<code><span leaf="">不出现概念的名字</span></code>' +
      '</pre>'
    const out = buildMarkdown(meta, html)
    expect(out).toContain('```markdown')
    expect(out).toContain('# 寓言写作 Prompt\n围绕 **{concept}** 写一个寓言故事\n不出现概念的名字')
  })
  it('escapes newlines and backslashes in frontmatter', () => {
    const md = buildMarkdown({ ...meta, title: 'Line1\nLine2', author: 'A\\B' }, '')
    expect(md).toContain('title: "Line1\\nLine2"')
    expect(md).toContain('author: "A\\\\B"')
  })
})

// 正文只取 frontmatter 与 H1 之后的部分，便于对表格做整段断言
const body = (html: string) => buildMarkdown(meta, html).split('# 标题\n\n')[1].trim()

describe('buildMarkdown 的 GFM 表格', () => {
  it('converts a standard table with thead', () => {
    const out = body(
      '<table><thead><tr><th>列A</th><th>列B</th></tr></thead>' +
      '<tbody><tr><td>甲</td><td>1</td></tr><tr><td>乙</td><td>2</td></tr></tbody></table>',
    )
    expect(out).toBe('| 列A | 列B |\n| --- | --- |\n| 甲 | 1 |\n| 乙 | 2 |')
  })

  it('uses the first row as header when thead is missing', () => {
    const out = body('<table><tbody><tr><td>H1</td><td>H2</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>')
    expect(out).toBe('| H1 | H2 |\n| --- | --- |\n| a | b |')
  })

  it('flattens WeChat section-wrapped cells into a single line', () => {
    // 微信真实形态：单元格内容被包成 <section><span leaf="">…</span></section>，
    // turndown 默认把 section 当块级 → 裸换行 → 非法 GFM
    const cell = (t: string) => `<td><section><span leaf="">${t}</span></section></td>`
    const out = body(
      `<table><tbody><tr>${cell('2025年业务')}${cell('收入')}</tr>` +
      `<tr>${cell('云服务')}${cell('120亿')}</tr></tbody></table>`,
    )
    expect(out).toBe('| 2025年业务 | 收入 |\n| --- | --- |\n| 云服务 | 120亿 |')
    expect(out.split('\n')).toHaveLength(3) // 无裸换行破行
  })

  it('escapes pipes and collapses <br> / multi-paragraph cells', () => {
    const out = body(
      '<table><tbody><tr><td>A|B</td><td>第一行<br>第二行</td></tr>' +
      '<tr><td><p>段一</p><p>段二</p></td><td>x</td></tr></tbody></table>',
    )
    expect(out).toContain('| A\\|B | 第一行 第二行 |')
    expect(out).toContain('| 段一 段二 | x |')
  })

  it('keeps inline formatting inside cells', () => {
    const out = body(
      '<table><tbody><tr><td>h</td><td>h2</td></tr>' +
      '<tr><td><strong>粗</strong></td><td><a href="https://x/y">链</a></td></tr></tbody></table>',
    )
    expect(out).toContain('| **粗** | [链](https://x/y) |')
  })

  it('pads short rows and drops empty tables', () => {
    const out = body('<table><tbody><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>1</td></tr></tbody></table>')
    expect(out).toBe('| a | b | c |\n| --- | --- | --- |\n| 1 |  |  |')
    expect(body('<table></table>')).toBe('')
  })
})
