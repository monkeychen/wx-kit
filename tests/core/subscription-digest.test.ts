import { describe, it, expect, vi } from 'vitest'
import { subscriptionDigest, type DigestDeps } from '../../src/core/subscription-digest'
import type { ArticleRef } from '../../src/core/mp-types'

const ref = (title: string, createTime: number, mid: number, idx = 1, itemShowType = 0): ArticleRef => ({
  url: `https://mp.weixin.qq.com/s/${title}`, title, createTime, appmsgid: mid, itemidx: idx, itemShowType,
})

const deps = (over: Partial<DigestDeps> = {}): DigestDeps => ({
  accounts: [{ fakeid: 'f1', nickname: '甲' }, { fakeid: 'f2', nickname: '乙' }],
  fromTs: 100, toTs: 999, date: '2026-07-23',
  listByDate: async (fakeid) => fakeid === 'f1' ? [ref('甲一', 500, 11)] : [ref('乙一', 700, 21)],
  isDownloaded: async () => false,
  ...over,
})

describe('subscriptionDigest', () => {
  it('跨号合并后按发布时间降序——用户问的是「那天发了什么」，不是「每个号发了什么」', async () => {
    const r = await subscriptionDigest(deps())
    expect(r.articles.map((a) => a.title)).toEqual(['乙一', '甲一'])
    expect(r.articles.map((a) => a.account)).toEqual(['乙', '甲'])
    expect(r).toMatchObject({ ok: true, date: '2026-07-23', accounts: 2, count: 2 })
  })

  it('downloaded 让 agent 直接分流：已下的读本地，没下的才 download', async () => {
    const r = await subscriptionDigest(deps({
      isDownloaded: async (id) => id === '11_1',
    }))
    expect(r.articles.find((a) => a.title === '甲一')?.downloaded).toBe(true)
    expect(r.articles.find((a) => a.title === '乙一')?.downloaded).toBe(false)
  })

  it('老库里的哈希 id 靠 url 兜底认出来——否则 agent 会照着 downloaded:false 重下一遍', async () => {
    const r = await subscriptionDigest(deps({
      // 模拟只认得 url 的老条目(id 对不上,url 对得上)
      isDownloaded: async (id, url) => url === 'https://mp.weixin.qq.com/s/甲一',
    }))
    expect(r.articles.find((a) => a.title === '甲一')?.downloaded).toBe(true)
  })

  it('id 用 mid_idx，与库内同源（agent 可直接拿它对账）', async () => {
    const r = await subscriptionDigest(deps())
    expect(r.articles.map((a) => a.id)).toEqual(['21_1', '11_1'])
  })

  it('itemShowType 带出来——视频/文字消息没有长正文，选题价值不同', async () => {
    const r = await subscriptionDigest(deps({
      listByDate: async (fakeid) => fakeid === 'f1' ? [ref('视频那篇', 500, 11, 1, 5)] : [],
    }))
    expect(r.articles[0].itemShowType).toBe(5)
  })

  it('某号失败不阻断其余号；ok 仍为 true（部分成功就是成功）', async () => {
    const r = await subscriptionDigest(deps({
      listByDate: async (fakeid) => {
        if (fakeid === 'f1') throw new Error('微信频率限制（200013）')
        return [ref('乙一', 700, 21)]
      },
    }))
    expect(r.ok).toBe(true)
    expect(r.count).toBe(1)
    expect(r.failures).toEqual([{ nickname: '甲', error: '微信频率限制（200013）' }])
  })

  it('一个号都没查成 → ok:false（那不是部分成功，是失败）', async () => {
    const r = await subscriptionDigest(deps({
      listByDate: async () => { throw new Error('登录态失效') },
    }))
    expect(r.ok).toBe(false)
    expect(r.failures).toHaveLength(2)
  })

  it('逐号进度按顺序回调——16 个号半分钟无输出会像卡死', async () => {
    const onProgress = vi.fn()
    await subscriptionDigest(deps({ onProgress }))
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { index: 1, total: 2, nickname: '甲', count: 1 },
      { index: 2, total: 2, nickname: '乙', count: 1 },
    ])
  })

  it('没有账号时不报错，给出空结果（没订阅号 ≠ 出错）', async () => {
    const r = await subscriptionDigest(deps({ accounts: [] }))
    expect(r).toMatchObject({ ok: true, accounts: 0, count: 0 })
    expect(r.articles).toEqual([])
  })

  it('串行查询：不并发压微信（频控纪律）', async () => {
    let inFlight = 0, maxInFlight = 0
    await subscriptionDigest(deps({
      listByDate: async () => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return []
      },
    }))
    expect(maxInFlight).toBe(1)
  })
})
