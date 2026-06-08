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
