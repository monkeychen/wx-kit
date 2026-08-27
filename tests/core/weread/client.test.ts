// tests/core/weread/client.test.ts
import { describe, it, expect } from 'vitest'
import { WereadClient, type WereadFetch } from '../../../src/core/weread/client'

const BOOK = 'MP_WXS_3634850725'

function page(entries: Array<{ reviewId: string; title: string; createTime: number; readNum?: number }>): unknown {
  return {
    errCode: 0,
    data: entries.map((e) => ({
      reviewId: `${BOOK}_${e.reviewId}`,
      title: e.title,
      createTime: e.createTime,
      mpInfo: { originalId: e.reviewId, ...(e.readNum != null ? { readNum: e.readNum } : {}) },
    })),
  }
}

describe('listPage · 请求形态约束', () => {
  it('首页：synckey=0，绝不带 offset（混用被服务端拒）', async () => {
    const calls: Array<Record<string, string | number>> = []
    const f: WereadFetch = async (path, params) => { calls.push({ path, ...params }); return { data: [] } }
    await new WereadClient(f).listPage(BOOK, { count: 20 })
    expect(calls[0]).toMatchObject({ path: '/mp/chapters', bookId: BOOK, count: 20, synckey: 0 })
    expect(calls[0]).not.toHaveProperty('offset')
  })
  it('翻页：只带 offset，绝不带 synckey', async () => {
    const calls: Array<Record<string, string | number>> = []
    const f: WereadFetch = async (_path, params) => { calls.push(params); return { data: [] } }
    await new WereadClient(f).listPage(BOOK, { count: 20, offset: 40 })
    expect(calls[0]).toMatchObject({ bookId: BOOK, offset: 40 })
    expect(calls[0]).not.toHaveProperty('synckey')
  })
  it('count 限幅 [1,50]', async () => {
    const calls: Array<Record<string, string | number>> = []
    const f: WereadFetch = async (_path, params) => { calls.push(params); return { data: [] } }
    await new WereadClient(f).listPage(BOOK, { count: 999 })
    await new WereadClient(f).listPage(BOOK, { count: 0 })
    expect(calls[0].count).toBe(50)
    expect(calls[1].count).toBe(1)
  })
  it('账号标识自动归一（老 base64 fakeid 也能用）', async () => {
    const calls: Array<Record<string, string | number>> = []
    const f: WereadFetch = async (_path, params) => { calls.push(params); return { data: [] } }
    await new WereadClient(f).listPage('MzYzNDg1MDcyNQ==', { count: 5 })
    expect(calls[0].bookId).toBe(BOOK)
  })
})

describe('listChaptersSince · 翻到水位为止', () => {
  it('某页出现 ≤ 水位的时间即停（返回值可含旧文，过滤在编排层）', async () => {
    let call = 0
    const f: WereadFetch = async () => {
      call++
      if (call === 1) return page([{ reviewId: 'a', title: '新1', createTime: 2000, readNum: 10 }])
      return page([
        { reviewId: 'b', title: '新2', createTime: 1500 },
        { reviewId: 'c', title: '旧', createTime: 900 },
      ])
    }
    const refs = await new WereadClient(f).listChaptersSince(BOOK, 1000)
    expect(call).toBe(2)
    expect(refs.map((r) => r.title)).toEqual(['新1', '新2', '旧'])
    expect(refs[0].readNum).toBe(10)
    expect(refs[0].url).toBe('https://mp.weixin.qq.com/s/a')
  })
  it('cap 上限兜底（水位太深不许无限翻）', async () => {
    let call = 0
    const f: WereadFetch = async () => {
      call++
      return page([{ reviewId: `t${call}`, title: `永远比水位新 ${call}`, createTime: 9000 + call }])
    }
    const refs = await new WereadClient(f).listChaptersSince(BOOK, 1000, 5)
    expect(call).toBeGreaterThanOrEqual(3) // 5 条上限 → 至少 3 页后停（20/页）
    expect(refs.length).toBeLessThanOrEqual(5 + 20) // 最后一页整页并入后可能略超 cap，与 listArticlesSince 行为一致
  })
})

describe('listChaptersByRange · count / 日期两种模式', () => {
  it('count 模式补齐即止', async () => {
    let call = 0
    const f: WereadFetch = async () => {
      call++
      return page([
        { reviewId: `a${call}`, title: `篇${call}-1`, createTime: 5000 },
        { reviewId: `b${call}`, title: `篇${call}-2`, createTime: 4000 },
      ])
    }
    const refs = await new WereadClient(f).listChaptersByRange(BOOK, { count: 3 })
    expect(call).toBe(2)
    expect(refs).toHaveLength(3)
  })
  it('日期模式：窗口内收录、越过下界即停', async () => {
    const f: WereadFetch = async () => page([
      { reviewId: 'new-out', title: '窗口后', createTime: Date.parse('2026-08-27T00:00:00') / 1000 },
      { reviewId: 'in', title: '窗口内', createTime: Date.parse('2026-08-26T12:00:00') / 1000 },
      { reviewId: 'old-out', title: '窗口前', createTime: Date.parse('2026-08-20T00:00:00') / 1000 },
    ])
    const refs = await new WereadClient(f).listChaptersByRange(BOOK, { from: '2026-08-25', to: '2026-08-26' })
    expect(refs.map((r) => r.title)).toEqual(['窗口内'])
  })
})
