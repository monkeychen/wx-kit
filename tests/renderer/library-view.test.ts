// tests/renderer/library-view.test.ts
import { describe, it, expect } from 'vitest'
import { accountName, accountOptions, filterByAccount, sortArticles, groupByAccount } from '../../src/renderer/library-view'
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

describe('accountOptions（R2：下拉 value 用身份、label 用名称）', () => {
  it('新条目：id=accountId，name=名称', () => {
    expect(accountOptions([mk({ id: 'n1', account: '猫笔刀', accountId: 'MP_WXS_123' })]))
      .toEqual([{ id: 'MP_WXS_123', name: '猫笔刀' }])
  })
  it('旧条目（无 accountId）：名称兼任 id（与旧下拉行为等价）', () => {
    expect(accountOptions([a])).toEqual([{ id: '猫笔刀', name: '猫笔刀' }])
  })
  it('混合库：同一号归并为一个选项，id 升级为真身份，保持首见序', () => {
    const old1 = mk({ id: 'o1', account: '猫笔刀' })
    const new1 = mk({ id: 'n1', account: '猫笔刀', accountId: 'MP_WXS_123' })
    const old2 = mk({ id: 'o2', account: '卡兹克' })
    expect(accountOptions([old1, new1, old2])).toEqual([
      { id: 'MP_WXS_123', name: '猫笔刀' },
      { id: '卡兹克', name: '卡兹克' },
    ])
  })
  it('同一身份、名称不同（改名前后）：归并为一个选项', () => {
    const before = mk({ id: 'r1', account: '旧名', accountId: 'MP_WXS_9' })
    const after = mk({ id: 'r2', account: '新名', accountId: 'MP_WXS_9' })
    expect(accountOptions([before, after])).toEqual([{ id: 'MP_WXS_9', name: '旧名' }])
  })
  it('空 account（未知公众号）不与具名号混排', () => {
    const unknown = mk({ id: 'u1', account: '' })
    expect(accountOptions([unknown, a])).toEqual([
      { id: '未知公众号', name: '未知公众号' },
      { id: '猫笔刀', name: '猫笔刀' },
    ])
  })
})

describe('filterByAccount', () => {
  it('null = all; otherwise only that account', () => {
    expect(filterByAccount([a, b, c], null)).toHaveLength(3)
    expect(filterByAccount([a, b, c], '猫笔刀').map((m) => m.id)).toEqual(['a', 'c'])
  })
})

describe('filterByAccount · 身份优先匹配 (M56)', () => {
  // MzYzNDg1MDcyNQ== ⇄ 3634850725 ⇄ MP_WXS_3634850725（见 src/core/weread/book-id.ts）
  const mp = mk({ id: 'm1', title: '身份文', account: '猫笔刀', accountId: 'MP_WXS_3634850725' })
  // 旧条目缺 accountId（v0.8.x 落盘），只能靠名称兜底
  const legacy = mk({ id: 'm2', title: '旧文', account: '猫笔刀' })
  const other = mk({ id: 'm3', title: '别号文', account: '卡兹克', accountId: 'MP_WXS_9999999999' })
  // 公众号改名后：文章里的名称已换，但 accountId 仍是同一身份——身份匹配的真正价值场景
  const renamed = mk({ id: 'm4', title: '改名文', account: '新名字', accountId: 'MP_WXS_3634850725' })
  const list = [mp, legacy, other, renamed]

  it('身份入参（base64 fakeid）归一后命中 MP_WXS_ 条目', () => {
    expect(filterByAccount(list, 'MzYzNDg1MDcyNQ==').map((m) => m.id)).toEqual(['m1', 'm4'])
  })

  it('MP_WXS_ / 纯数字 / base64 三种历史形态互认', () => {
    expect(filterByAccount(list, 'MP_WXS_3634850725').map((m) => m.id)).toEqual(['m1', 'm4'])
    expect(filterByAccount(list, '3634850725').map((m) => m.id)).toEqual(['m1', 'm4'])
  })

  it('公众号改名后身份仍命中（名称不同不误伤身份匹配）', () => {
    expect(filterByAccount([renamed], 'MzYzNDg1MDcyNQ==').map((m) => m.id)).toEqual(['m4'])
  })

  it('缺 accountId 的旧条目按名称兜底命中', () => {
    expect(filterByAccount([legacy], '猫笔刀').map((m) => m.id)).toEqual(['m2'])
  })

  it('名称入参命中同名条目（新条目有 accountId 也不妨碍名称路径）', () => {
    expect(filterByAccount(list, '卡兹克').map((m) => m.id)).toEqual(['m3'])
  })

  it('无命中返回空数组；身份与名称都不匹配时不误伤其它号的文章', () => {
    expect(filterByAccount(list, '不存在')).toEqual([])
    expect(filterByAccount(list, 'MP_WXS_1111222233')).toEqual([])
    // base64 入参也不能把「同名但无身份」的旧条目捎上——身份入参只走身份
    expect(filterByAccount([legacy], 'MzYzNDg1MDcyNQ==')).toEqual([])
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
