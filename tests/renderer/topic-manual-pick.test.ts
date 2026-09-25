import { describe, expect, it } from 'vitest'
import type { ArticleMeta } from '../../src/core/types'
import {
  DEFAULT_MANUAL_FILTER,
  MANUAL_ALL_SOURCES,
  buildManualPickView,
  manualDateLabel,
  manualSourceOptions,
  matchesManualKeyword,
  resolveExcerpt,
  sourceKind,
  withinManualTime,
  type ManualFilterState,
} from '../../src/renderer/topic-manual-pick'

// 北京时间 2026-09-20 12:00
const AS_OF = Date.parse('2026-09-20T04:00:00Z')
const DAY = 86_400_000

function article(id: string, patch: Partial<ArticleMeta> = {}): ArticleMeta {
  return {
    id,
    title: `文章 ${id}`,
    author: '合成作者',
    account: '甲号',
    accountId: 'biz-jia',
    publishTime: '2026-09-19 10:00',
    sourceUrl: `https://mp.weixin.qq.com/s/${id}`,
    digest: '',
    coverUrl: '',
    downloadTime: '2026-09-20T04:00:00Z',
    formats: ['md'],
    dir: `/synthetic-library/${id}`,
    ...patch,
  }
}

const daysAgo = (days: number): string => {
  const ms = AS_OF - days * DAY
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ').slice(0, 16)
}

const view = (list: ArticleMeta[], state: Partial<ManualFilterState> = {}, selectedIds: string[] = []) =>
  buildManualPickView(list, { ...DEFAULT_MANUAL_FILTER, ...state }, { asOfMs: AS_OF, selectedIds })

describe('手动选稿 · 时间快捷段', () => {
  const list = [
    article('a', { publishTime: daysAgo(1) }),
    article('b', { publishTime: daysAgo(10) }),
    article('c', { publishTime: daysAgo(60) }),
    article('d', { publishTime: daysAgo(200) }),
  ]

  it('默认近 30 天，不默认全量', () => {
    expect(DEFAULT_MANUAL_FILTER.time).toBe('30d')
    expect(view(list).hits.map(item => item.id)).toEqual(['a', 'b'])
  })

  it.each([
    ['7d', ['a']],
    ['30d', ['a', 'b']],
    ['90d', ['a', 'b', 'c']],
    ['all', ['a', 'b', 'c', 'd']],
  ] as const)('%s 段按原文发表时间收窄', (time, ids) => {
    expect(view(list, { time }).hits.map(item => item.id)).toEqual([...ids])
  })

  it('「今年」按北京时间年份判定，不按机器时区', () => {
    const cross = [article('last-year', { publishTime: '2025-12-31 23:59' }), article('this-year', { publishTime: '2026-01-01 00:01' })]
    expect(view(cross, { time: 'year' }).hits.map(item => item.id)).toEqual(['this-year'])
  })

  it('时间未知的条目：非「全部」不纳入，但计数告知，切到全部即可见', () => {
    const withUnknown = [...list, article('u', { publishTime: '' })]
    const narrow = view(withUnknown, { time: '30d' })
    expect(narrow.hits.map(item => item.id)).toEqual(['a', 'b'])
    expect(narrow.unknownTimeCount).toBe(1)
    expect(view(withUnknown, { time: 'all' }).hits.map(item => item.id)).toContain('u')
    expect(view(withUnknown, { time: 'all' }).unknownTimeCount).toBe(0)
  })

  it('withinManualTime 对无法解析的时间只在全部下为真', () => {
    const unknown = article('u', { publishTime: '未知' })
    expect(withinManualTime(unknown, '30d', AS_OF)).toBe(false)
    expect(withinManualTime(unknown, 'all', AS_OF)).toBe(true)
  })
})

describe('手动选稿 · 来源筛选', () => {
  it('选中身份时，同号无 accountId 的旧条目也一起命中（等价类归并）', () => {
    const list = [
      article('new1', { accountId: 'biz-jia', account: '甲号', publishTime: daysAgo(1) }),
      article('old1', { account: '甲号', publishTime: daysAgo(3) }), // 无 accountId
      article('other', { accountId: 'biz-yi', account: '乙号', publishTime: daysAgo(2) }),
    ]
    expect(view(list, { sourceId: 'biz-jia' }).hits.map(item => item.id)).toEqual(['new1', 'old1'])
  })

  it('来源下拉的篇数跟随当前时间段', () => {
    const list = [
      article('a', { accountId: 'biz-jia', account: '甲号', publishTime: daysAgo(1) }),
      article('b', { accountId: 'biz-jia', account: '甲号', publishTime: daysAgo(100) }),
    ]
    expect(manualSourceOptions(list, '30d', AS_OF).find(item => item.id === 'biz-jia')?.count).toBe(1)
    expect(manualSourceOptions(list, 'all', AS_OF).find(item => item.id === 'biz-jia')?.count).toBe(2)
  })

  it('墨问条目与公众号区分开，供下拉分组', () => {
    const mowen = article('m', { accountId: 'mo-laoichi', account: '老池', sourceUrl: 'https://note.mowen.cn/detail/abc' })
    expect(sourceKind(mowen)).toBe('mowen')
    expect(sourceKind(article('w'))).toBe('wx')
    expect(manualSourceOptions([mowen, article('w')], 'all', AS_OF).map(item => item.kind)).toEqual(['mowen', 'wx'])
  })
})

describe('手动选稿 · 关键词', () => {
  const list = [
    article('a', { title: '大模型落地观察', account: '甲号' }),
    article('b', { title: '别的题目', account: '乙号', digest: '大模型' }),
  ]

  it('匹配标题与来源，且大小写不敏感', () => {
    expect(view(list, { keyword: '大模型' }).hits.map(item => item.id)).toEqual(['a'])
    expect(view(list, { keyword: '乙号' }).hits.map(item => item.id)).toEqual(['b'])
    expect(view(list, { keyword: '  大模型  ' }).hits.map(item => item.id)).toEqual(['a'])
  })

  it('不搜正文：命中范围可预期，用户才算得清漏了什么', () => {
    expect(view(list, { keyword: '大模型' }).hits.map(item => item.id)).not.toContain('b')
    expect(matchesManualKeyword(list[1], '大模型')).toBe(false)
  })
})

describe('手动选稿 · 排序与分组', () => {
  const list = [
    article('a', { publishTime: '2026-09-20 09:00', account: '甲号' }),
    article('b', { publishTime: '2026-09-19 09:00', account: '乙号' }),
    article('c', { publishTime: '2026-09-18 09:00', account: '甲号' }),
  ]

  it('默认最新在前，可切最早在前', () => {
    expect(DEFAULT_MANUAL_FILTER.sort).toBe('new')
    expect(view(list).visible.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(view(list, { sort: 'old' }).visible.map(item => item.id)).toEqual(['c', 'b', 'a'])
  })

  it('按时间分组时组头是日期，无时间的单列一组', () => {
    const groups = view([...list, article('u', { publishTime: '' })], { time: 'all' }).groups
    expect(groups.map(group => group.label)).toEqual(['今天', '昨天', '9月18日 · 周五', '时间未知'])
  })

  it('按来源分组时，同一公众号的条目聚在一起且组内新的在前', () => {
    const groups = view(list, { sort: 'source' }).groups
    expect(groups.map(group => group.label)).toEqual(['甲号', '乙号'])
    expect(groups[0].items.map(item => item.id)).toEqual(['a', 'c'])
  })
})

describe('手动选稿 · 已选保留', () => {
  const list = [
    article('a', { publishTime: daysAgo(1) }),
    article('b', { publishTime: daysAgo(100) }),
  ]

  it('已选但不在当前条件下的篇数单独计数，供底部提示', () => {
    expect(view(list, { time: '30d' }, ['a', 'b']).hiddenSelectedCount).toBe(1)
    expect(view(list, { time: 'all' }, ['a', 'b']).hiddenSelectedCount).toBe(0)
  })

  it('「仅看已选」只留下已勾选的条目', () => {
    expect(view(list, { time: 'all', onlyPicked: true }, ['b']).visible.map(item => item.id)).toEqual(['b'])
  })
})

describe('手动选稿 · 分组日期写法', () => {
  it('今天 / 昨天 / 同年 / 跨年各有写法', () => {
    expect(manualDateLabel(AS_OF, AS_OF)).toBe('今天')
    expect(manualDateLabel(AS_OF - DAY, AS_OF)).toBe('昨天')
    expect(manualDateLabel(Date.parse('2026-03-01T00:00:00Z'), AS_OF)).toBe('3月1日 · 周日')
    expect(manualDateLabel(Date.parse('2025-12-03T00:00:00Z'), AS_OF)).toBe('2025年12月3日')
    expect(manualDateLabel(null, AS_OF)).toBe('时间未知')
  })
})

describe('手动选稿 · 全部来源哨兵', () => {
  it('MANUAL_ALL_SOURCES 表示不过滤来源', () => {
    expect(MANUAL_ALL_SOURCES).toBe('all')
    const list = [article('a', { accountId: 'biz-jia' }), article('b', { accountId: 'biz-yi' })]
    expect(view(list).hits).toHaveLength(2)
  })
})

describe('resolveExcerpt（M78 看一眼）', () => {
  it('digest 优先：有摘要直接用，不碰正文', () => {
    const out = resolveExcerpt({ digest: '作者写的摘要' }, '# 正文\n内容')
    expect(out).toEqual({ kind: 'digest', text: '作者写的摘要' })
  })

  it('digest 为空时用正文：去 frontmatter/图片/代码块/链接语法，截断加省略号', () => {
    const md = ['---', 'title: x', '---', '', '## 小标题', '这是正文第一段，有 **加粗** 和 [链接](https://a.b)。', '', '![图](images/a.png)', '```', 'code()', '```', '第二段内容。'].join('\n')
    const out = resolveExcerpt({ digest: '  ' }, md)
    expect(out.kind).toBe('content')
    expect(out.text).toContain('小标题')
    expect(out.text).toContain('这是正文第一段，有 加粗 和 链接。')
    expect(out.text).not.toContain('images/')
    expect(out.text).not.toContain('code()')
  })

  it('正文超长截断到 200 字并加省略号', () => {
    const out = resolveExcerpt({ digest: '' }, '很'.repeat(500))
    expect(out.kind).toBe('content')
    expect(out.text.length).toBe(201)
    expect(out.text.endsWith('…')).toBe(true)
  })

  it('digest 与正文都不可用：none（UI 给如实文案）', () => {
    expect(resolveExcerpt({ digest: '' }, undefined).kind).toBe('none')
    expect(resolveExcerpt({ digest: '' }, '').kind).toBe('none')
  })
})
