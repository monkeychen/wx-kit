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

describe('accountOptions（R2：下拉 value 用身份、label 用名称；keys 为组内等价类）', () => {
  it('新条目：id=accountId，name=名称，keys 含名称与身份', () => {
    expect(accountOptions([mk({ id: 'n1', account: '猫笔刀', accountId: 'MP_WXS_123' })]))
      .toEqual([{ id: 'MP_WXS_123', name: '猫笔刀', keys: ['猫笔刀', 'MP_WXS_123'] }])
  })
  it('旧条目（无 accountId）：名称兼任 id（与旧下拉行为等价）', () => {
    expect(accountOptions([a])).toEqual([{ id: '猫笔刀', name: '猫笔刀', keys: ['猫笔刀'] }])
  })
  it('混合库：同一号归并为一个选项，id 升级为真身份，keys 并入两代形态，保持首见序', () => {
    const old1 = mk({ id: 'o1', account: '猫笔刀' })
    const new1 = mk({ id: 'n1', account: '猫笔刀', accountId: 'MP_WXS_123' })
    const old2 = mk({ id: 'o2', account: '卡兹克' })
    expect(accountOptions([old1, new1, old2])).toEqual([
      { id: 'MP_WXS_123', name: '猫笔刀', keys: ['猫笔刀', 'MP_WXS_123'] },
      { id: '卡兹克', name: '卡兹克', keys: ['卡兹克'] },
    ])
  })
  it('同一身份、名称不同（改名前后）：归并为一个选项，keys 含两代名称', () => {
    const before = mk({ id: 'r1', account: '旧名', accountId: 'MP_WXS_9' })
    const after = mk({ id: 'r2', account: '新名', accountId: 'MP_WXS_9' })
    expect(accountOptions([before, after])).toEqual([
      { id: 'MP_WXS_9', name: '旧名', keys: ['旧名', 'MP_WXS_9', '新名'] },
    ])
  })
  it('空 account（未知公众号）不与具名号混排', () => {
    const unknown = mk({ id: 'u1', account: '' })
    expect(accountOptions([unknown, a])).toEqual([
      { id: '未知公众号', name: '未知公众号', keys: ['未知公众号'] },
      { id: '猫笔刀', name: '猫笔刀', keys: ['猫笔刀'] },
    ])
  })
})

describe('filterByAccount', () => {
  it('null = all; otherwise only that account', () => {
    const opt = accountOptions([a, b, c]).find((o) => o.name === '猫笔刀') ?? null
    expect(filterByAccount([a, b, c], null)).toHaveLength(3)
    expect(filterByAccount([a, b, c], opt).map((m) => m.id)).toEqual(['a', 'c'])
  })
})

describe('filterByAccount · 身份归一与等价类 (M56/M57)', () => {
  // MzYzNDg1MDcyNQ== ⇄ 3634850725 ⇄ MP_WXS_3634850725（见 src/core/weread/book-id.ts）
  const mp = mk({ id: 'm1', title: '身份文', account: '猫笔刀', accountId: 'MP_WXS_3634850725' })
  // 旧条目缺 accountId（v0.8.x 落盘），只能靠名称兜底
  const legacy = mk({ id: 'm2', title: '旧文', account: '猫笔刀' })
  const other = mk({ id: 'm3', title: '别号文', account: '卡兹克', accountId: 'MP_WXS_9999999999' })
  // 公众号改名后：文章里的名称已换，但 accountId 仍是同一身份——身份匹配的真正价值场景
  const renamed = mk({ id: 'm4', title: '改名文', account: '新名字', accountId: 'MP_WXS_3634850725' })
  const list = [mp, legacy, other, renamed]
  const optOf = (name: string) => accountOptions(list).find((o) => o.name === name)!

  it('选中该号选项（身份 id）：三种历史形态条目与新旧名称条目全命中——M57 回归（此前只剩带身份的几篇）', () => {
    const opt = optOf('猫笔刀')
    expect(opt.id).toBe('MP_WXS_3634850725')
    expect(filterByAccount(list, opt).map((m) => m.id)).toEqual(['m1', 'm2', 'm4'])
  })

  it('改名条目靠身份 key 命中（不误伤别号）', () => {
    expect(filterByAccount(list, optOf('猫笔刀')).some((m) => m.id === 'm3')).toBe(false)
    expect(filterByAccount([renamed], optOf('猫笔刀')).map((m) => m.id)).toEqual(['m4'])
  })

  it('纯旧条目库：名称 key 兜底命中', () => {
    expect(filterByAccount([legacy], optOf('猫笔刀')).map((m) => m.id)).toEqual(['m2'])
  })

  it('不存在的选项：空结果', () => {
    const miss = { id: '不存在', name: '不存在', keys: ['不存在'] }
    expect(filterByAccount(list, miss)).toEqual([])
    expect(filterByAccount(list, { id: 'MP_WXS_1111222233', name: 'x', keys: ['MP_WXS_1111222233'] })).toEqual([])
  })

  it('订阅页跳转的降级选项（id=身份 + name=昵称，Library 构造）：身份与名称 key 都参与匹配', () => {
    const fallback = { id: 'MzYzNDg1MDcyNQ==', name: '猫笔刀', keys: ['MP_WXS_3634850725', '猫笔刀'] }
    expect(filterByAccount(list, fallback).map((m) => m.id)).toEqual(['m1', 'm2', 'm4'])
    // 单条旧文（无身份）：名称 key 接住
    expect(filterByAccount([legacy], { id: 'MP_WXS_3634850725', name: '猫笔刀', keys: ['MP_WXS_3634850725', '猫笔刀'] })).toHaveLength(1)
  })
})
