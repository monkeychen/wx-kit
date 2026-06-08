// tests/renderer/library-view.test.ts
import { describe, it, expect } from 'vitest'
import { accountName, accountsOf, filterByAccount, sortArticles, groupByAccount } from '../../src/renderer/library-view'
import type { ArticleMeta } from '../../src/core/types'

const mk = (over: Partial<ArticleMeta>): ArticleMeta => ({
  id: over.id ?? 'i', title: '', author: '', account: '', publishTime: '', sourceUrl: '',
  digest: '', coverUrl: '', downloadTime: '', formats: [], dir: '', ...over,
})

const a = mk({ id: 'a', title: '甲文', account: '猫笔刀', publishTime: '2026-05-24', downloadTime: '2026-06-08T10:00:00.000Z' })
const b = mk({ id: 'b', title: '乙文', account: '卡兹克', publishTime: '2026-05-26', downloadTime: '2026-06-08T09:00:00.000Z' })
const c = mk({ id: 'c', title: '丙文', account: '猫笔刀', publishTime: '', downloadTime: '2026-06-07T08:00:00.000Z' })

describe('accountName', () => {
  it('falls back to 未知公众号', () => {
    expect(accountName(a)).toBe('猫笔刀')
    expect(accountName(mk({ account: '' }))).toBe('未知公众号')
  })
})

describe('accountsOf', () => {
  it('unique, first-seen order', () => {
    expect(accountsOf([a, b, c])).toEqual(['猫笔刀', '卡兹克'])
  })
})

describe('filterByAccount', () => {
  it('null = all; otherwise only that account', () => {
    expect(filterByAccount([a, b, c], null)).toHaveLength(3)
    expect(filterByAccount([a, b, c], '猫笔刀').map((m) => m.id)).toEqual(['a', 'c'])
  })
})

describe('sortArticles', () => {
  it('download desc (newest first) / asc', () => {
    expect(sortArticles([a, b, c], 'download', 'desc').map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(sortArticles([a, b, c], 'download', 'asc').map((m) => m.id)).toEqual(['c', 'b', 'a'])
  })
  it('publish desc, empty publishTime always last', () => {
    expect(sortArticles([a, b, c], 'publish', 'desc').map((m) => m.id)).toEqual(['b', 'a', 'c'])
    // asc：仍把空 publish 置后，不让它冒到最前
    expect(sortArticles([a, b, c], 'publish', 'asc').map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })
  it('title via localeCompare', () => {
    const ids = sortArticles([a, b, c], 'title', 'asc').map((m) => m.id)
    expect(ids).toContain('a'); expect(ids).toHaveLength(3)
  })
  it('does not mutate input', () => {
    const input = [a, b, c]
    sortArticles(input, 'download', 'asc')
    expect(input.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('groupByAccount', () => {
  it('groups preserving sorted order of accounts and items', () => {
    const sorted = sortArticles([a, b, c], 'download', 'desc') // a, b, c
    const g = groupByAccount(sorted)
    expect(g.map((x) => x.account)).toEqual(['猫笔刀', '卡兹克'])
    expect(g[0].items.map((m) => m.id)).toEqual(['a', 'c'])
    expect(g[1].items.map((m) => m.id)).toEqual(['b'])
  })
})
