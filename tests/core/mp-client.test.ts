// tests/core/mp-client.test.ts
import { describe, it, expect } from 'vitest'
import { searchAccount, listArticles, listArticlesSince } from '../../src/core/mp-client'
import { MpAuthExpired, MpRateLimited, MpApiError } from '../../src/core/mp-errors'
import type { MpFetch } from '../../src/core/mp-types'

const fakeFetch = (json: unknown): MpFetch => async () => json as never

describe('searchAccount', () => {
  it('maps the candidate list', async () => {
    const mpFetch = fakeFetch({
      base_resp: { ret: 0 },
      list: [{ fakeid: 'FID1', nickname: '猫笔刀', alias: 'maobid', signature: 'sig' }],
    })
    const out = await searchAccount(mpFetch, 'TOKEN', '猫笔刀')
    expect(out).toEqual([{ fakeid: 'FID1', nickname: '猫笔刀', alias: 'maobid', signature: 'sig' }])
  })

  it('throws MpAuthExpired on ret 200040', async () => {
    await expect(searchAccount(fakeFetch({ base_resp: { ret: 200040 } }), 'T', 'x'))
      .rejects.toBeInstanceOf(MpAuthExpired)
  })

  it('throws MpRateLimited on ret 200013', async () => {
    await expect(searchAccount(fakeFetch({ base_resp: { ret: 200013 } }), 'T', 'x'))
      .rejects.toBeInstanceOf(MpRateLimited)
  })

  it('throws MpApiError on other non-zero ret', async () => {
    await expect(searchAccount(fakeFetch({ base_resp: { ret: 99, err_msg: 'boom' } }), 'T', 'x'))
      .rejects.toBeInstanceOf(MpApiError)
  })
})

const noSleep = { sleep: async () => {} }
const mk = (n: number) => ({ link: `u${n}`, title: `t${n}`, create_time: 1700000000 - n, item_show_type: 0, itemidx: 1 })

// appmsg?type=9 的响应形状:扁平 `app_msg_list[]`,总数在 `app_msg_cnt`。
// 微信每页实回常少于请求的 count(实测 ~5),helper 支持指定 pageSize 模拟。
type Article = ReturnType<typeof mk>
function listFetch(items: Article[], pageSize = 20): MpFetch {
  return async (_endpoint, params) => {
    const begin = Number(params.begin)
    return { base_resp: { ret: 0 }, app_msg_cnt: items.length, app_msg_list: items.slice(begin, begin + pageSize) } as never
  }
}

describe('listArticles count mode', () => {
  it('truncates to count within a page', async () => {
    const refs = await listArticles(listFetch([mk(0), mk(1), mk(2), mk(3)]), 'T', 'FID', { count: 3 }, noSleep)
    expect(refs.map((r) => r.url)).toEqual(['u0', 'u1', 'u2'])
  })

  it('accumulates across pages (>20 items)', async () => {
    const items = Array.from({ length: 22 }, (_, i) => mk(i)) // 2 页：20 + 2
    const refs = await listArticles(listFetch(items), 'T', 'FID', { count: 21 }, noSleep)
    expect(refs).toHaveLength(21)
    expect(refs[20].url).toBe('u20') // 第 21 篇来自第 2 页
  })

  it('stops when list is exhausted before reaching count', async () => {
    const refs = await listArticles(listFetch([mk(0)]), 'T', 'FID', { count: 50 }, noSleep)
    expect(refs.map((r) => r.url)).toEqual(['u0'])
  })

  it('接口返回少于请求数时游标仍连续 —— 按固定步长推进会跳内容', async () => {
    // appmsg 每页实回 ~5(少于请求的 count=20);游标必须按实际返回数推进,否则跳内容。
    const items = Array.from({ length: 12 }, (_, i) => mk(i))
    const refs = await listArticles(listFetch(items, 5), 'T', 'FID', { count: 7 }, noSleep)
    expect(refs.map((r) => r.url)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6'])
  })

  it('skips items without a link', async () => {
    const fetch = listFetch([
      { title: 'no-link', create_time: 1, item_show_type: 0, itemidx: 1 } as never,
      { link: 'u1', title: 't', create_time: 2, item_show_type: 0, itemidx: 1 },
    ])
    const refs = await listArticles(fetch, 'T', 'FID', { count: 10 }, noSleep)
    expect(refs.map((r) => r.url)).toEqual(['u1'])
  })
})

describe('listArticlesSince (订阅检查:翻到水位为止)', () => {
  // create_time 递减(最新在前):第 i 篇 = 1000 - i
  const mkTs = (i: number) => ({ link: `u${i}`, title: `t${i}`, create_time: 1000 - i })
  // 统计请求次数的分页 fetch(每页 5 篇,贴近真实微信)
  const counted = (items: ReturnType<typeof mkTs>[]) => {
    let calls = 0
    const fetch: MpFetch = async (_e, params) => {
      calls++
      const begin = Number(params.begin)
      return { base_resp: { ret: 0 }, app_msg_cnt: items.length, app_msg_list: items.slice(begin, begin + 5) } as never
    }
    return { fetch, calls: () => calls }
  }

  it('first page already reaches the watermark → exactly 1 request (the common daily case)', async () => {
    const { fetch, calls } = counted(Array.from({ length: 15 }, (_, i) => mkTs(i)))
    // 水位 = 第 2 篇的时间:第一页(前 5 篇)就含已读
    const refs = await listArticlesSince(fetch, 'T', 'FID', 1000 - 2, noSleep)
    expect(calls()).toBe(1)
    expect(refs.map((r) => r.url)).toContain('u0')
  })

  it('whole first page newer than watermark → pages deeper until a known article', async () => {
    const { fetch, calls } = counted(Array.from({ length: 15 }, (_, i) => mkTs(i)))
    // 水位 = 第 7 篇:第一页 5 篇全新 → 翻第二页(含第 7 篇)即止
    const refs = await listArticlesSince(fetch, 'T', 'FID', 1000 - 7, noSleep)
    expect(calls()).toBe(2)
    const newer = refs.filter((r) => r.createTime > 1000 - 7)
    expect(newer).toHaveLength(7)   // u0..u6 全部带回,不漏
  })

  it('caps at 20 scanned articles when everything is newer', async () => {
    const { fetch, calls } = counted(Array.from({ length: 40 }, (_, i) => mkTs(i)))
    const refs = await listArticlesSince(fetch, 'T', 'FID', 0, noSleep)   // 水位极旧:全新
    expect(refs.length).toBeLessThanOrEqual(20)
    expect(calls()).toBe(4)   // 4 页 × 5 = 20 封顶
  })

  it('stops when the list is exhausted', async () => {
    const { fetch, calls } = counted([mkTs(0), mkTs(1)])
    const refs = await listArticlesSince(fetch, 'T', 'FID', 0, noSleep)
    expect(refs).toHaveLength(2)
    expect(calls()).toBe(1)
  })

  it('empty list → no refs, 1 request', async () => {
    const { fetch, calls } = counted([])
    expect(await listArticlesSince(fetch, 'T', 'FID', 100, noSleep)).toEqual([])
    expect(calls()).toBe(1)
  })
})

describe('listArticles date mode', () => {
  // unix 秒，UTC 正午避免时区翻日
  const ts = (d: string) => Date.parse(`${d}T12:00:00`) / 1000
  const item = (d: string) => ({ link: `u${d}`, title: d, create_time: ts(d), item_show_type: 0, itemidx: 1 })

  it('keeps only items within [from,to], newest-first', async () => {
    const refs = await listArticles(
      listFetch([item('2026-02-27'), item('2026-02-26'), item('2026-02-25'), item('2026-02-24')]),
      'T', 'FID', { from: '2026-02-25', to: '2026-02-26' }, { sleep: async () => {} },
    )
    expect(refs.map((r) => r.title)).toEqual(['2026-02-26', '2026-02-25'])
  })

  it('日期窗口落在分页缺口里也能找到', async () => {
    // 历史故障「猫笔刀 0 篇」的回归测试:每页只回 5 条时,
    // 若按固定 20 跳页,窗口内的文章正好落在被跳过的缺口里。
    const days = Array.from({ length: 25 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 5, 8) - i * 86_400_000) // 06-08 倒推
      return item(d.toISOString().slice(0, 10))
    })
    const refs = await listArticles(listFetch(days, 5), 'T', 'FID', { from: '2026-05-24', to: '2026-05-27' }, { sleep: async () => {} })
    expect(refs.map((r) => r.title)).toEqual(['2026-05-27', '2026-05-26', '2026-05-25', '2026-05-24'])
  })
})

describe('ret 码翻译(解析之前)', () => {
  it('频控 200013 → MpRateLimited', async () => {
    const limited: MpFetch = async () => ({ base_resp: { ret: 200013 } }) as never
    await expect(listArticles(limited, 'T', 'FID', { count: 5 }, noSleep)).rejects.toBeInstanceOf(MpRateLimited)
  })
})
