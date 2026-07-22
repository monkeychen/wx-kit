// tests/core/library-sort.test.ts
import { describe, it, expect } from 'vitest'
import { sortArticles } from '../../src/core/library-sort'
import type { ArticleMeta } from '../../src/core/types'

const mk = (over: Partial<ArticleMeta>): ArticleMeta => ({
  id: 'x', title: 't', author: 'a', account: 'acc',
  publishTime: '', sourceUrl: '', digest: '', coverUrl: '',
  downloadTime: '2026-01-01T00:00:00.000Z', formats: [], dir: '/d',
  ...over,
})

describe('sortArticles', () => {
  it('publish desc: publishTime 大的在前;asc 反之', () => {
    const list = [
      mk({ id: '1', publishTime: '2026-01-01 08:00' }),
      mk({ id: '2', publishTime: '2026-03-01 08:00' }),
      mk({ id: '3', publishTime: '2026-02-01 08:00' }),
    ]
    expect(sortArticles(list, 'publish', 'desc').map((m) => m.id)).toEqual(['2', '3', '1'])
    expect(sortArticles(list, 'publish', 'asc').map((m) => m.id)).toEqual(['1', '3', '2'])
  })

  it('download 按 downloadTime 字典序(ISO 即时序)', () => {
    const list = [
      mk({ id: 'b', downloadTime: '2026-02-01T00:00:00.000Z' }),
      mk({ id: 'a', downloadTime: '2026-03-01T00:00:00.000Z' }),
    ]
    expect(sortArticles(list, 'download', 'desc').map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('title 用中文 localeCompare', () => {
    const list = [mk({ id: '1', title: '张' }), mk({ id: '2', title: '阿' })]
    const asc = sortArticles(list, 'title', 'asc').map((m) => m.id)
    // 不断言具体拼音序(随 ICU 版本),只断言稳定可逆:asc 与 desc 互为反序
    const desc = sortArticles(list, 'title', 'desc').map((m) => m.id)
    expect(desc).toEqual([...asc].reverse())
  })

  it('空 publishTime 恒置末尾(升降序皆然)', () => {
    const list = [
      mk({ id: '空', publishTime: '' }),
      mk({ id: '新', publishTime: '2026-03-01 08:00' }),
      mk({ id: '旧', publishTime: '2026-01-01 08:00' }),
    ]
    // desc:新 → 旧 → 空
    expect(sortArticles(list, 'publish', 'desc').map((m) => m.id)).toEqual(['新', '旧', '空'])
    // asc:旧 → 新 → 空(空仍在末尾,不冒头)
    expect(sortArticles(list, 'publish', 'asc').map((m) => m.id)).toEqual(['旧', '新', '空'])
  })

  it('不改输入', () => {
    const list = [mk({ id: '1', publishTime: '2026-01-01 08:00' }), mk({ id: '2', publishTime: '2026-03-01 08:00' })]
    const snapshot = list.map((m) => m.id)
    sortArticles(list, 'publish', 'desc')
    expect(list.map((m) => m.id)).toEqual(snapshot)
  })
})
