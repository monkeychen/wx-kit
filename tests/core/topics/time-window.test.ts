import { describe, expect, it } from 'vitest'
import type { ArticleMeta } from '../../../src/core/types'
import type { TopicWindowInput } from '../../../src/core/topics/types'
import { classifyTopicPublication, resolveTopicWindow, selectTopicArticles, selectTopicArticlesByIds } from '../../../src/core/topics/time-window'

/** 测试里绝大多数场景是时间窗口；manual 分支单独测。返回类型窄化到时间分支。 */
function timeWindow(input: Parameters<typeof resolveTopicWindow>[0], asOf = AS_OF): Exclude<ReturnType<typeof resolveTopicWindow>, { preset: 'manual' }> {
  const window = resolveTopicWindow(input, asOf)
  if (window.preset === 'manual') throw new Error('测试期望时间窗口')
  return window
}

const AS_OF = Date.parse('2026-09-20T04:00:00Z')
const article = (id: string, publishTime: string): ArticleMeta => ({
  id, title: '同名文章', author: '合成作者', account: '合成账号', publishTime,
  sourceUrl: `https://example.invalid/articles/${id}`, digest: '', coverUrl: '',
  downloadTime: '2026-09-20T03:00:00Z', formats: ['md'], dir: `/synthetic-library/${id}`,
})

describe('选题时间范围', () => {
  it('默认冻结点击时刻的过去 24 小时，不使用上次分析水位', () => {
    expect(resolveTopicWindow(undefined, AS_OF)).toEqual({
      preset: '24h', fromMs: Date.parse('2026-09-19T04:00:00Z'), toMs: AS_OF,
      asOfMs: AS_OF, timeZone: 'Asia/Shanghai',
    })
  })

  it.each([
    ['3d', '2026-09-17T04:00:00Z'],
    ['7d', '2026-09-13T04:00:00Z'],
  ] as const)('允许用户选择 %s，保留小时边界', (preset, from) => {
    expect(resolveTopicWindow({ preset }, AS_OF)).toMatchObject({ fromMs: Date.parse(from), toMs: AS_OF })
  })

  it('自定义包含结束日，按北京时间而不是机器时区', () => {
    expect(resolveTopicWindow({ preset: 'custom', from: '2026-09-18', to: '2026-09-19' }, AS_OF)).toEqual({
      preset: 'custom', fromMs: Date.parse('2026-09-17T16:00:00Z'),
      toMs: Date.parse('2026-09-19T16:00:00Z'), asOfMs: AS_OF, timeZone: 'Asia/Shanghai',
    })
  })

  it('自定义同一天仍覆盖完整一天', () => {
    expect(resolveTopicWindow({ preset: 'custom', from: '2026-09-19', to: '2026-09-19' }, AS_OF))
      .toMatchObject({ fromMs: Date.parse('2026-09-18T16:00:00Z'), toMs: Date.parse('2026-09-19T16:00:00Z') })
  })

  it.each([
    { preset: 'custom', from: '2026-02-30', to: '2026-03-01' },
    { preset: 'custom', from: '2026-09-20', to: '2026-09-19' },
    { preset: 'custom', from: '', to: '2026-09-19' },
    { preset: 'custom', from: '2026-09-18 10:00', to: '2026-09-19' },
    { preset: 'custom', from: '2026-9-18', to: '2026-09-19' },
    { preset: 'custom', from: ' 2026-09-18', to: '2026-09-19' },
    { preset: 'custom', from: '2026-09-18', to: 'bad' },
    { preset: 'automatic' },
    { preset: 'custom' },
    null,
  ])('拒绝无效运行时输入 %j', input => {
    expect(() => resolveTopicWindow(input as TopicWindowInput, AS_OF)).toThrow()
  })

  it.each([NaN, Infinity, -Infinity, 9e15])('拒绝无法表示的时钟 %s', asOf => {
    expect(() => resolveTopicWindow(undefined, asOf)).toThrow()
  })
})

describe('原文时间及精度', () => {
  const window = timeWindow(undefined)

  it.each([
    ['2026-09-19 12:00', true],
    ['2026-09-19 11:59:59', false],
    ['2026-09-20 11:59:59', true],
    ['2026-09-20 12:00', false],
    ['2026-09-19T04:00:00Z', true],
    ['2026-09-19T00:00:00-04:00', true],
  ])('精确时刻 %s 按左闭右开窗口判断', (time, included) => {
    expect(classifyTopicPublication(time, window).included).toBe(included)
  })

  it('保留精确时刻和输入精度', () => {
    expect(classifyTopicPublication('2026-09-19 12:00', window)).toEqual({
      included: true, precision: 'instant', publishedAtMs: Date.parse('2026-09-19T04:00:00Z'),
    })
  })

  it.each(['2026-09-19', '2026-09-20', ' 2026-09-19 '])('只有日期且部分重叠时明确不确定：%s', time => {
    expect(classifyTopicPublication(time, window)).toEqual({ included: false, reason: 'uncertain-publication-time' })
  })

  it('较长范围完整覆盖的日期精度文章可以入选', () => {
    expect(classifyTopicPublication('2026-09-19', timeWindow({ preset: '3d' }))).toEqual({
      included: true, precision: 'day', publishedAtMs: Date.parse('2026-09-18T16:00:00Z'),
    })
  })

  it('自定义日期范围完整接纳指定日的日期精度文章', () => {
    const custom = timeWindow({ preset: 'custom', from: '2026-09-19', to: '2026-09-19' })
    expect(classifyTopicPublication('2026-09-19', custom).included).toBe(true)
    expect(classifyTopicPublication('2026-09-20 00:00', custom))
      .toEqual({ included: false, reason: 'outside-window' })
  })

  it.each(['', ' ', 'not-a-date', '2026-02-30', '2026-09-19 24:00'])('未知或非法时间不偷偷代入今天：%s', time => {
    expect(classifyTopicPublication(time, window))
      .toEqual({ included: false, reason: 'unknown-publication-time' })
  })

  it.each(['2026-09-21', '2026-09-20 12:00:01'])('未来发表独立标明：%s', time => {
    expect(classifyTopicPublication(time, window)).toEqual({ included: false, reason: 'future-publication-time' })
  })

  it('旧日期完全不相交时属于范围外，不误报日期精度不足', () => {
    expect(classifyTopicPublication('2026-09-18', window)).toEqual({ included: false, reason: 'outside-window' })
  })
})

describe('按发表时间筛选文库元信息', () => {
  it('忽略下载时间和订阅状态，并保留同名不同文章', () => {
    const input = [article('old', '2026-09-18 12:00'), article('new-a', '2026-09-20 10:00'), article('new-b', '2026-09-20 11:00')]
    const result = selectTopicArticles(input, timeWindow(undefined))
    expect(result.articles.map(a => a.id)).toEqual(['new-a', 'new-b'])
    expect(result.excluded).toEqual([{ id: 'old', publishTime: '2026-09-18 12:00', reason: 'outside-window' }])
  })

  it('空输入返回空结果，不自动扩大范围', () => {
    expect(selectTopicArticles([], timeWindow(undefined))).toEqual({ articles: [], excluded: [] })
  })

  it('未知和不精确的时间留痕，不改变原数组或对象', () => {
    const input = Object.freeze([
      Object.freeze(article('unknown', '')),
      Object.freeze(article('day-only', '2026-09-19')),
      Object.freeze(article('valid', '2026-09-20 08:00')),
    ])
    const original = JSON.stringify(input)
    const result = selectTopicArticles(input, timeWindow(undefined))
    expect(result.articles.map(a => a.id)).toEqual(['valid'])
    expect(result.excluded).toEqual([
      { id: 'unknown', publishTime: '', reason: 'unknown-publication-time' },
      { id: 'day-only', publishTime: '2026-09-19', reason: 'uncertain-publication-time' },
    ])
    expect(JSON.stringify(input)).toBe(original)
  })
})

describe('手动选篇（M75：用户指名，不做时间判定）', () => {
  it('resolveTopicWindow manual：保留 ID 去重、带 asOf、拒绝空清单', () => {
    const window = resolveTopicWindow({ preset: 'manual', articleIds: ['a1', 'a2', 'a1'] }, AS_OF)
    expect(window).toEqual({ preset: 'manual', articleIds: ['a1', 'a2'], asOfMs: AS_OF, timeZone: 'Asia/Shanghai' })
    expect(() => resolveTopicWindow({ preset: 'manual', articleIds: [] }, AS_OF)).toThrow(/选择至少一篇文章/)
    expect(() => resolveTopicWindow({ preset: 'manual', articleIds: [''] }, AS_OF)).toThrow(/选择至少一篇文章/)
    expect(() => resolveTopicWindow({ preset: 'manual', articleIds: Array.from({ length: 31 }, (_, i) => `a${i}`) }, AS_OF)).toThrow(/30/)
  })

  it('selectTopicArticlesByIds：按给定顺序命中，缺失 ID 显式返回', () => {
    const input = [article('a1', '2020-01-01 00:00'), article('a2', '2026-09-20 10:00')]
    const window = resolveTopicWindow({ preset: 'manual', articleIds: ['a2', 'a1', 'ghost'] }, AS_OF)
    if (window.preset !== 'manual') throw new Error('类型守卫')
    const result = selectTopicArticlesByIds(input, window)
    expect(result.articles.map(a => a.id)).toEqual(['a2', 'a1'])
    expect(result.missing).toEqual(['ghost'])
    expect(result.excluded).toEqual([])
  })

  it('发布时间无法解析的指名文章照常入选（用户意志优先于时间归类）', () => {
    const window = resolveTopicWindow({ preset: 'manual', articleIds: ['weird'] }, AS_OF)
    if (window.preset !== 'manual') throw new Error('类型守卫')
    const result = selectTopicArticlesByIds([article('weird', '')], window)
    expect(result.articles.map(a => a.id)).toEqual(['weird'])
    expect(result.missing).toEqual([])
  })
})
