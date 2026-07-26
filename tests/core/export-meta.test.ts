// tests/core/export-meta.test.ts
import { describe, it, expect } from 'vitest'
import { buildMeta } from '../../src/core/exporter/export-meta'
import type { ParsedArticle } from '../../src/core/types'

const parsed: ParsedArticle = {
  title: 'T', author: 'A', account: 'A', publishTime: '2026-02-25 08:00',
  digest: 'D', coverUrl: 'https://x/c', contentHtml: '<p>x</p>', imageUrls: [], videos: [], itemShowType: 0, warnings: []
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

describe('buildMeta 带出 v0.8.2 新字段', () => {
  const base = {
    title: 't', author: 'a', account: 'acc', publishTime: '2026-07-12 13:20',
    digest: 'd', coverUrl: '', contentHtml: '<p>x</p>', imageUrls: [], videos: [], warnings: [],
  }
  const ctx = { id: 'i', sourceUrl: 'https://x', dir: '/tmp/d', formats: ['meta'] as const, now: '2026-07-26T00:00:00Z' }

  it('记录 itemShowType(让「这篇是什么类型」可查、可筛)', () => {
    const m = buildMeta({ ...ctx, formats: ['meta'], parsed: { ...base, itemShowType: 5 } })
    expect(m.itemShowType).toBe(5)
  })

  it('读不到类型时不写该字段(不用 0 冒充「普通图文」)', () => {
    const m = buildMeta({ ...ctx, formats: ['meta'], parsed: { ...base, itemShowType: null } })
    expect('itemShowType' in m).toBe(false)
  })

  it('itemShowType 为 0 时照样写(0 是有效值,不是「空」)', () => {
    const m = buildMeta({ ...ctx, formats: ['meta'], parsed: { ...base, itemShowType: 0 } })
    expect(m.itemShowType).toBe(0)
  })
})
