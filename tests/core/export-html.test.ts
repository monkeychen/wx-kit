// tests/core/export-html.test.ts
import { describe, it, expect } from 'vitest'
import { buildHtml } from '../../src/core/exporter/export-html'
import type { ArticleMeta } from '../../src/core/types'

const meta: ArticleMeta = {
  id: '1', title: '标题<x>', author: '公众号', account: '公众号',
  publishTime: '2026-02-25', sourceUrl: 'https://x/s', digest: '',
  coverUrl: '', downloadTime: '2026-06-06T00:00:00.000Z', formats: ['html'], dir: '/d',
}

describe('buildHtml', () => {
  const html = buildHtml(meta, '<p>正文 <img src="images/img-1.jpg"></p>')
  it('is a full self-contained document', () => {
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<meta charset="utf-8"')
    expect(html).toContain('<style>')
  })
  it('escapes title in head but renders heading', () => {
    expect(html).toContain('<title>标题&lt;x&gt;</title>')
  })
  it('embeds meta header and local image', () => {
    expect(html).toContain('公众号')
    expect(html).toContain('src="images/img-1.jpg"')
  })
  it('escapes double-quote in href and title', () => {
    const html = buildHtml({ ...meta, sourceUrl: 'https://x.com/s?a=1"&b=2' }, '')
    expect(html).toContain('href="https://x.com/s?a=1&quot;&amp;b=2"')
  })
})
