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
})
