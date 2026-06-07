// tests/core/mp-client.test.ts
import { describe, it, expect } from 'vitest'
import { searchAccount, listArticles } from '../../src/core/mp-client'
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
const mk = (n: number) => ({ link: `u${n}`, title: `t${n}`, create_time: 1700000000 - n })

// 模拟真实分页：count=20/页，begin 为偏移；total 控制有几页。
function realPagedFetch(items: ReturnType<typeof mk>[]): MpFetch {
  return async (_endpoint, params) => {
    const begin = Number(params.begin)
    return { base_resp: { ret: 0 }, app_msg_cnt: items.length, app_msg_list: items.slice(begin, begin + 20) } as never
  }
}

describe('listArticles count mode', () => {
  it('truncates to count within a page', async () => {
    const refs = await listArticles(realPagedFetch([mk(0), mk(1), mk(2), mk(3)]), 'T', 'FID', { count: 3 }, noSleep)
    expect(refs.map((r) => r.url)).toEqual(['u0', 'u1', 'u2'])
  })

  it('accumulates across pages (>20 items)', async () => {
    const items = Array.from({ length: 22 }, (_, i) => mk(i)) // 2 页：20 + 2
    const refs = await listArticles(realPagedFetch(items), 'T', 'FID', { count: 21 }, noSleep)
    expect(refs).toHaveLength(21)
    expect(refs[20].url).toBe('u20') // 第 21 篇来自第 2 页
  })

  it('stops when list is exhausted before reaching count', async () => {
    const refs = await listArticles(realPagedFetch([mk(0)]), 'T', 'FID', { count: 50 }, noSleep)
    expect(refs.map((r) => r.url)).toEqual(['u0'])
  })

  it('skips items without a link', async () => {
    const fetch: MpFetch = async () => ({
      base_resp: { ret: 0 }, app_msg_cnt: 2,
      app_msg_list: [{ title: 'no-link', create_time: 1 }, { link: 'u1', title: 't', create_time: 2 }],
    }) as never
    const refs = await listArticles(fetch, 'T', 'FID', { count: 10 }, noSleep)
    expect(refs.map((r) => r.url)).toEqual(['u1'])
  })
})

describe('listArticles date mode', () => {
  // unix 秒，UTC 正午避免时区翻日
  const ts = (d: string) => Date.parse(`${d}T12:00:00`) / 1000
  const item = (d: string) => ({ link: `u${d}`, title: d, create_time: ts(d) })

  it('keeps only items within [from,to], newest-first', async () => {
    const fetch: MpFetch = async () => ({
      base_resp: { ret: 0 }, app_msg_cnt: 4,
      app_msg_list: [item('2026-02-27'), item('2026-02-26'), item('2026-02-25'), item('2026-02-24')],
    }) as never
    const refs = await listArticles(fetch, 'T', 'FID', { from: '2026-02-25', to: '2026-02-26' }, { sleep: async () => {} })
    expect(refs.map((r) => r.title)).toEqual(['2026-02-26', '2026-02-25'])
  })
})
