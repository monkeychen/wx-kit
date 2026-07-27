import { describe, it, expect } from 'vitest'
import { refId, mergeNewRefs, removeRefs } from '../../src/core/subscription-refs'
import type { ArticleRef } from '../../src/core/mp-types'

const ref = (over: Partial<ArticleRef> & { title: string }): ArticleRef => ({
  url: `https://mp.weixin.qq.com/s/${over.title}`,
  createTime: 1_700_000_000,
  ...over,
})

describe('refId', () => {
  it('用微信自己的文章主键 mid_idx——与文库判重同源', () => {
    expect(refId(ref({ title: 'a', appmsgid: 2247486000, itemidx: 1 }))).toBe('2247486000_1')
  })

  it('列表没给主键时退回 url，而不是造一个新的身份体系', () => {
    expect(refId(ref({ title: 'b', url: 'https://mp.weixin.qq.com/s/XYZ' }))).toBe('https://mp.weixin.qq.com/s/XYZ')
  })
})

describe('mergeNewRefs', () => {
  const older = ref({ title: '旧的一篇', appmsgid: 1, itemidx: 1, createTime: 100 })
  const kept = ref({ title: '留着没处理的', appmsgid: 2, itemidx: 1, createTime: 200 })
  const fresh = ref({ title: '刚发现的', appmsgid: 3, itemidx: 1, createTime: 300 })

  it('留存的待处理文章不被新一轮检查冲掉（本次修复的核心）', () => {
    // 旧实现是整体覆盖：留着 2 篇不处理，下次检查发现 1 篇新的就只剩那 1 篇
    const out = mergeNewRefs([older, kept], [fresh])
    expect(out.map((r) => r.title)).toEqual(['刚发现的', '留着没处理的', '旧的一篇'])
  })

  it('同一篇不重复，且以新一轮的字段为准（标题可能被作者改过）', () => {
    const renamed = ref({ title: '改过的标题', appmsgid: 2, itemidx: 1, createTime: 200 })
    const out = mergeNewRefs([kept], [renamed])
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('改过的标题')
  })

  it('结果按发布时间降序（最新的在上，与文库默认序一致）', () => {
    expect(mergeNewRefs([older], [fresh, kept]).map((r) => r.createTime)).toEqual([300, 200, 100])
  })

  it('两侧空集的边界', () => {
    expect(mergeNewRefs([], [])).toEqual([])
    expect(mergeNewRefs([], [fresh])).toEqual([fresh])
    expect(mergeNewRefs([kept], [])).toEqual([kept])
  })
})

describe('removeRefs', () => {
  const a = ref({ title: 'A', appmsgid: 1, itemidx: 1 })
  const b = ref({ title: 'B', appmsgid: 2, itemidx: 1 })
  const c = ref({ title: 'C', appmsgid: 2, itemidx: 2 })   // 同 mid 不同 idx：是另一篇

  it('只删指定的几篇，其余留在待处理里', () => {
    expect(removeRefs([a, b, c], ['1_1']).map((r) => r.title)).toEqual(['B', 'C'])
  })

  it('同 mid 不同 idx 不误伤', () => {
    expect(removeRefs([a, b, c], ['2_1']).map((r) => r.title)).toEqual(['A', 'C'])
  })

  it('全删等价于清空；空 ids 原样返回', () => {
    expect(removeRefs([a, b, c], ['1_1', '2_1', '2_2'])).toEqual([])
    expect(removeRefs([a, b, c], [])).toEqual([a, b, c])
  })
})
