// tests/core/mp-client.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

// appmsgpublish 的响应形状：三层嵌套，中间两层是 JSON 字符串，
// 且 begin/count 按「群发组」计（一组可能多篇）。测试 helper 必须照这个形状造，
// 否则测的是一个不存在的接口。
type Article = ReturnType<typeof mk>
const mkGroup = (arts: Article[]) => ({ publish_type: 1, publish_info: JSON.stringify({ type: 9, appmsgex: arts }) })
function publishFetch(groups: ReturnType<typeof mkGroup>[], pageSize = 20): MpFetch {
  return async (_endpoint, params) => {
    const begin = Number(params.begin)
    return { base_resp: { ret: 0 }, publish_page: JSON.stringify({
      total_count: groups.length, publish_list: groups.slice(begin, begin + pageSize),
    }) } as never
  }
}
/** 每组一篇（大多数情况）；一组多篇的展开在下方 appmsgpublish 用例里单独覆盖 */
function realPagedFetch(items: Article[]): MpFetch {
  return publishFetch(items.map((i) => mkGroup([i])))
}
function pagedFetch(items: Article[], pageSize: number): MpFetch {
  return publishFetch(items.map((i) => mkGroup([i])), pageSize)
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

  it('接口返回少于请求数时游标仍连续 —— 按固定步长推进会跳内容', async () => {
    // 请求 count=20 但每页只回 5 组（旧的 appmsg 接口一贯如此；换 appmsgpublish 后
    // 常规每页给满 20，但「回得比要的少」始终可能发生，游标必须按实际返回数推进）。
    const items = Array.from({ length: 12 }, (_, i) => mk(i))
    const refs = await listArticles(pagedFetch(items, 5), 'T', 'FID', { count: 7 }, noSleep)
    expect(refs.map((r) => r.url)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6'])
  })

  it('skips items without a link', async () => {
    const fetch = publishFetch([mkGroup([
      { title: 'no-link', create_time: 1, item_show_type: 0, itemidx: 1 } as never,
      { link: 'u1', title: 't', create_time: 2, item_show_type: 0, itemidx: 1 },
    ])])
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
      return { base_resp: { ret: 0 }, publish_page: JSON.stringify({
        total_count: items.length,
        publish_list: items.slice(begin, begin + 5).map((i) => mkGroup([i as never])),
      }) } as never
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
    const fetch = publishFetch(
      [item('2026-02-27'), item('2026-02-26'), item('2026-02-25'), item('2026-02-24')]
        .map((i) => mkGroup([i as never])))
    const refs = await listArticles(fetch, 'T', 'FID', { from: '2026-02-25', to: '2026-02-26' }, { sleep: async () => {} })
    expect(refs.map((r) => r.title)).toEqual(['2026-02-26', '2026-02-25'])
  })

  it('日期窗口落在分页缺口里也能找到', async () => {
    // 历史故障「猫笔刀 0 篇」的回归测试：每页只回 5 条时，
    // 若按固定 20 跳页，窗口内的文章正好落在被跳过的缺口里。
    const days = Array.from({ length: 25 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 5, 8) - i * 86_400_000) // 06-08 倒推
      return item(d.toISOString().slice(0, 10))
    })
    const refs = await listArticles(pagedFetch(days, 5), 'T', 'FID', { from: '2026-05-24', to: '2026-05-27' }, { sleep: async () => {} })
    expect(refs.map((r) => r.title)).toEqual(['2026-05-27', '2026-05-26', '2026-05-25', '2026-05-24'])
  })
})

// ── M36:列表接口换成 appmsgpublish(旧的 appmsg?type=9 只返回图文素材) ──
describe('appmsgpublish 列表解析(M36)', () => {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, '../fixtures/appmsgpublish.json'), 'utf-8'),
  ) as Record<string, unknown>
  const fixtureGroups = JSON.parse(String(fixture.publish_page)).publish_list as ReturnType<typeof mkGroup>[]
  // 必须按 begin 真分页:fetch 无视 begin 一直返回同一页的话,调用方会一直翻下去、重复累积
  const fixtureFetch = publishFetch(fixtureGroups)

  it('全部消息类型都进列表,并带出 itemShowType', async () => {
    const refs = await listArticles(fixtureFetch, 'T', 'FID', { count: 50 }, noSleep)
    const kinds = [...new Set(refs.map((r) => r.itemShowType))].sort((a, b) => Number(a) - Number(b))
    // 旧接口只会给 0;这里必须同时看到文字(10)、视频(5)、图文消息(8)
    expect(kinds).toEqual([0, 5, 8, 10])
  })

  it('一次群发多篇全部展开,按 itemidx 顺序', async () => {
    const refs = await listArticles(fixtureFetch, 'T', 'FID', { count: 50 }, noSleep)
    const multi = refs.filter((r) => r.title.startsWith('一次群发'))
    expect(multi.map((r) => r.title)).toEqual(['一次群发·头条', '一次群发·次条'])
  })

  it('已删除的文章不进列表', async () => {
    const refs = await listArticles(fixtureFetch, 'T', 'FID', { count: 50 }, noSleep)
    expect(refs.some((r) => r.title.includes('已删除'))).toBe(false)
  })

  // ── M38:读者打不开的文章一律不进列表 ──
  // 它们的页面是微信的错误页(「此内容发送失败无法查看…涉嫌违规」),
  // 列进来只会产生**必然失败**的下载,还把失败原因说成笼统的「no title parsed」。
  it('审核不通过(checking)与被封禁(ban_flag)的文章都不进列表', async () => {
    const refs = await listArticles(fixtureFetch, 'T', 'FID', { count: 50 }, noSleep)
    expect(refs.some((r) => r.title.includes('审核不通过'))).toBe(false)
    expect(refs.some((r) => r.title.includes('被封禁'))).toBe(false)
    // 正常文章不受影响
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.some((r) => r.title.includes('一次群发·头条'))).toBe(true)
  })

  it('被过滤的条数经 onHidden 上报(上层要据此判断结果是否不及预期)', async () => {
    let hidden = 0
    await listArticles(fixtureFetch, 'T', 'FID', { count: 50 },
      { ...noSleep, onHidden: (n) => { hidden += n } })
    expect(hidden).toBe(3)   // fixture 里 is_deleted / checking / ban_flag 各一条
  })

  it('count 模式会往前补齐 —— 要 N 篇就给 N 篇可下的', async () => {
    // 前两组都不可见,若不补齐就只能拿到 1 篇
    const mkA = (n: number, flags: Record<string, unknown> = {}) =>
      mkGroup([{ link: `u${n}`, title: `t${n}`, create_time: 1700000000 - n, item_show_type: 0, itemidx: 1, ...flags } as never])
    const groups = [
      mkA(0, { checking: 1 }), mkA(1, { ban_flag: 1 }), mkA(2), mkA(3), mkA(4),
    ]
    const refs = await listArticles(publishFetch(groups, 2), 'T', 'FID', { count: 3 }, noSleep)
    expect(refs.map((r) => r.title)).toEqual(['t2', 't3', 't4'])
  })

  it('全部不可见时不死循环,返回空', async () => {
    const groups = [0, 1, 2, 3].map((n) =>
      mkGroup([{ link: `u${n}`, title: `t${n}`, create_time: 1700000000 - n, item_show_type: 0, itemidx: 1, checking: 1 } as never]))
    const refs = await listArticles(publishFetch(groups, 2), 'T', 'FID', { count: 5 }, noSleep)
    expect(refs).toEqual([])
  })

  it('日期范围模式:窗口内的不可见文章被剔除,且不因剔除误判「已翻出窗口」', async () => {
    const ts = (d: string) => Date.parse(`${d}T12:00:00`) / 1000
    const mkD = (d: string, flags: Record<string, unknown> = {}) =>
      mkGroup([{ link: `u${d}`, title: d, create_time: ts(d), item_show_type: 0, itemidx: 1, ...flags } as never])
    const groups = [
      mkD('2026-02-27'),                    // 窗口外(晚于 to)
      mkD('2026-02-26', { checking: 1 }),   // 窗口内但不可见 → 剔除,且不得让循环提前结束
      mkD('2026-02-25'),                    // 窗口内,必须拿到
      mkD('2026-02-24'),                    // 窗口外(早于 from)→ 到此停止
    ]
    const refs = await listArticles(publishFetch(groups, 2), 'T', 'FID',
      { from: '2026-02-25', to: '2026-02-26' }, noSleep)
    expect(refs.map((r) => r.title)).toEqual(['2026-02-25'])
  })

  it('订阅检查:最新几篇都不可见时仍能翻到水位并停下(不无限翻)', async () => {
    let calls = 0
    const mkS = (n: number, flags: Record<string, unknown> = {}) =>
      mkGroup([{ link: `u${n}`, title: `t${n}`, create_time: 1000 - n, item_show_type: 0, itemidx: 1, ...flags } as never])
    const groups = [mkS(0, { checking: 1 }), mkS(1, { checking: 1 }), mkS(2), mkS(3)]
    const fetch: MpFetch = async (e, p) => { calls++; return publishFetch(groups, 2)(e, p) }
    const refs = await listArticlesSince(fetch, 'T', 'FID', 1000 - 2, noSleep)
    // 第一页两条都不可见 → 不命中水位、继续翻;第二页命中即停。
    // 返回值含扫到的旧文章(新旧判定由 checkSubscriptions 按水位做),故 t3 也在内。
    expect(refs.map((r) => r.title)).toEqual(['t2', 't3'])
    expect(calls).toBeLessThanOrEqual(2)   // 关键:没有因为整页被过滤就无限翻
  })

  it('游标按「组数」推进 —— 一组多篇时不能按文章数推进,否则会跳组', async () => {
    // 6 组共 7 篇(含 1 组两篇、1 条已删除);每页 2 组
    const seen: number[] = []
    const spy: MpFetch = async (endpoint, params) => {
      seen.push(Number(params.begin))
      const pp = JSON.parse(String((fixture as { publish_page: string }).publish_page))
      const begin = Number(params.begin)
      return { base_resp: { ret: 0 }, publish_page: JSON.stringify({
        total_count: pp.publish_list.length, publish_list: pp.publish_list.slice(begin, begin + 2),
      }) } as never
    }
    await listArticles(spy, 'T', 'FID', { count: 99 }, noSleep)
    expect(seen).toEqual([0, 2, 4, 6])   // 按组数 +2,不是按文章数(fixture 现有 8 组)
  })

  it('脏数据不炸整次抓取:publish_page 不是合法 JSON 时返回空页', async () => {
    const bad: MpFetch = async () => ({ base_resp: { ret: 0 }, publish_page: '{oops' }) as never
    await expect(listArticles(bad, 'T', 'FID', { count: 5 }, noSleep)).resolves.toEqual([])
  })

  it('频控/登录态判定不受影响(仍在解析之前)', async () => {
    const limited: MpFetch = async () => ({ base_resp: { ret: 200013 } }) as never
    await expect(listArticles(limited, 'T', 'FID', { count: 5 }, noSleep)).rejects.toBeInstanceOf(MpRateLimited)
  })
})
