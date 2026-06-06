// tests/core/export-meta.test.ts
import { describe, it, expect } from 'vitest'
import { buildMeta } from '../../src/core/exporter/export-meta'
import type { ParsedArticle } from '../../src/core/types'

const parsed: ParsedArticle = {
  title: 'T', author: 'A', account: 'A', publishTime: '2026-02-25 08:00',
  digest: 'D', coverUrl: 'https://x/c', contentHtml: '<p>x</p>', imageUrls: [],
}

describe('buildMeta', () => {
  it('assembles ArticleMeta from parsed + context', () => {
    const m = buildMeta({
      parsed, id: '1_1_x', sourceUrl: 'https://x/s', dir: '/lib/A/2026_T',
      formats: ['md', 'meta'], now: '2026-06-06T00:00:00.000Z',
    })
    expect(m).toMatchObject({
      id: '1_1_x', title: 'T', account: 'A', sourceUrl: 'https://x/s',
      coverUrl: 'https://x/c', downloadTime: '2026-06-06T00:00:00.000Z',
      formats: ['md', 'meta'], dir: '/lib/A/2026_T',
    })
  })
})
