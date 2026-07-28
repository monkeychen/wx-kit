import { describe, it, expect, vi } from 'vitest'
import { subscriptionDigest, fetchMissing, type DigestDeps, type DigestArticle } from '../../src/core/subscription-digest'
import type { ArticleRef } from '../../src/core/mp-types'

const ref = (title: string, createTime: number, mid: number, idx = 1, itemShowType = 0): ArticleRef => ({
  url: `https://mp.weixin.qq.com/s/${title}`, title, createTime, appmsgid: mid, itemidx: idx, itemShowType,
})

const deps = (over: Partial<DigestDeps> = {}): DigestDeps => ({
  accounts: [{ fakeid: 'f1', nickname: '甲' }, { fakeid: 'f2', nickname: '乙' }],
  fromTs: 100, toTs: 999, date: '2026-07-23',
  listByDate: async (fakeid) => fakeid === 'f1' ? [ref('甲一', 500, 11)] : [ref('乙一', 700, 21)],
  localOf: async () => null,
  ...over,
})

describe('subscriptionDigest', () => {
  it('跨号合并后按发布时间降序——用户问的是「那天发了什么」，不是「每个号发了什么」', async () => {
    const r = await subscriptionDigest(deps())
    expect(r.articles.map((a) => a.title)).toEqual(['乙一', '甲一'])
    expect(r.articles.map((a) => a.account)).toEqual(['乙', '甲'])
    expect(r).toMatchObject({ ok: true, date: '2026-07-23', accounts: 2, count: 2 })
  })

  it('已在库的直接给出本地路径——agent 拿到清单就能读，不必再查一次库', async () => {
    const r = await subscriptionDigest(deps({
      localOf: async (id) => id === '11_1'
        ? { dir: '/lib/甲/2026-07-23_甲一', contentPath: '/lib/甲/2026-07-23_甲一/content.md' }
        : null,
    }))
    const a = r.articles.find((x) => x.title === '甲一')!
    expect(a).toMatchObject({ downloaded: true, dir: '/lib/甲/2026-07-23_甲一', contentPath: '/lib/甲/2026-07-23_甲一/content.md' })
    const b = r.articles.find((x) => x.title === '乙一')!
    expect(b.downloaded).toBe(false)
    expect(b.dir).toBeUndefined()          // 没下载就没有路径，别给个不存在的
    expect(b.contentPath).toBeUndefined()
  })

  it('已在库文章的解析告警也带出来——选题前该知道这篇当初解析得可疑', async () => {
    const r = await subscriptionDigest(deps({
      localOf: async () => ({ dir: '/lib/x', contentPath: '/lib/x/content.md', warnings: ['未识别的消息类型 99'] }),
    }))
    expect(r.articles[0].warnings).toEqual(['未识别的消息类型 99'])
  })

  it('库里没有 md 时不给 contentPath——给个指向不存在文件的路径比不给更糟', async () => {
    const r = await subscriptionDigest(deps({ localOf: async () => ({ dir: '/lib/x' }) }))
    expect(r.articles[0]).toMatchObject({ downloaded: true, dir: '/lib/x' })
    expect(r.articles[0].contentPath).toBeUndefined()
  })

  it('老库里的哈希 id 靠 url 兜底认出来——否则 agent 会照着 downloaded:false 重下一遍', async () => {
    const r = await subscriptionDigest(deps({
      // 模拟只认得 url 的老条目(id 对不上,url 对得上)
      localOf: async (_id, url) => url === 'https://mp.weixin.qq.com/s/甲一' ? { dir: '/lib/甲' } : null,
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

describe('fetchMissing（--download 那一步）', () => {
  const art = (over: Partial<DigestArticle> & { title: string }): DigestArticle => ({
    account: '甲', publishTime: '2026-07-23T00:00:00.000Z', url: `https://mp.weixin.qq.com/s/${over.title}`,
    downloaded: false, id: `${over.title}_1`, ...over,
  })
  const okDl = (dir: string) => async () => ({ ok: true as const, dir })

  it('只下没在库里的；已下载的一次都不调 download', async () => {
    const download = vi.fn<(url: string, hint: unknown) => Promise<{ ok: true; dir: string }>>(okDl('/lib/new'))
    const out = await fetchMissing(
      [art({ title: '有', downloaded: true, dir: '/lib/old' }), art({ title: '缺' })],
      { download },
    )
    expect(download).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0][0]).toContain('缺')
    expect(out[0]).toMatchObject({ title: '有', dir: '/lib/old' })      // 原样，不动
    expect(out[1]).toMatchObject({ title: '缺', downloaded: true, dir: '/lib/new' })
  })

  it('下成之后给 contentPath——形状与本来就有的完全一致', async () => {
    const out = await fetchMissing([art({ title: 'x' })], {
      download: okDl('/lib/x'),
      contentPathOf: (dir) => `${dir}/content.md`,
    })
    expect(out[0].contentPath).toBe('/lib/x/content.md')
  })

  it('没选 md 时不给 contentPath', async () => {
    const out = await fetchMissing([art({ title: 'x' })], { download: okDl('/lib/x') })
    expect(out[0].dir).toBe('/lib/x')
    expect(out[0].contentPath).toBeUndefined()
  })

  it('下载失败：条目留在清单里并带原因，不静默消失', async () => {
    const out = await fetchMissing([art({ title: 'boom' })], {
      download: async () => ({ ok: false as const, error: '微信频率限制（200013）' }),
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ downloaded: false, error: '微信频率限制（200013）' })
    expect(out[0].dir).toBeUndefined()
  })

  it('「读者本就打不开」单独标出——重试无用，别让 agent 死磕', async () => {
    const out = await fetchMissing([art({ title: 'gone' })], {
      download: async () => ({ ok: false as const, error: '该文章读者不可见', unavailable: true }),
    })
    expect(out[0]).toMatchObject({ downloaded: false, unavailable: true })
  })

  it('下载带回的告警并入条目', async () => {
    const out = await fetchMissing([art({ title: 'x' })], {
      download: async () => ({ ok: true as const, dir: '/lib/x', warnings: ['视频下载失败'] }),
    })
    expect(out[0].warnings).toEqual(['视频下载失败'])
  })

  it('串行下载：并发数恒为 1（频控纪律）', async () => {
    let inFlight = 0, max = 0
    await fetchMissing([art({ title: 'a' }), art({ title: 'b' }), art({ title: 'c' })], {
      download: async () => {
        inFlight++; max = Math.max(max, inFlight)
        await new Promise((r) => setTimeout(r, 3))
        inFlight--
        return { ok: true as const, dir: '/lib/x' }
      },
    })
    expect(max).toBe(1)
  })

  it('进度按顺序回调，只数要下的那几篇', async () => {
    const onProgress = vi.fn()
    await fetchMissing(
      [art({ title: '有', downloaded: true, dir: '/d' }), art({ title: 'a' }), art({ title: 'b' })],
      { download: okDl('/lib/x'), onProgress },
    )
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { index: 1, total: 2, title: 'a' },
      { index: 2, total: 2, title: 'b' },
    ])
  })

  it('全部已在库 / 空清单 → 一次都不调 download', async () => {
    const download = vi.fn(okDl('/x'))
    expect(await fetchMissing([], { download })).toEqual([])
    await fetchMissing([art({ title: '有', downloaded: true, dir: '/d' })], { download })
    expect(download).not.toHaveBeenCalled()
  })

  it('不原地改入参（便于排查与重跑）', async () => {
    const input = [art({ title: 'x' })]
    const out = await fetchMissing(input, { download: okDl('/lib/x') })
    expect(input[0].downloaded).toBe(false)
    expect(out[0].downloaded).toBe(true)
  })
})
