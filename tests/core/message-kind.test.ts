// tests/core/message-kind.test.ts
import { describe, it, expect } from 'vitest'
import { readItemShowType, kindOf, kindTag, unknownKindWarning } from '../../src/core/message-kind'

describe('readItemShowType', () => {
  it('从脚本变量读出类型', () => {
    expect(readItemShowType("var x = 1; item_show_type: '10' * 1,")).toBe(10)
    expect(readItemShowType("item_show_type: '0' * 1")).toBe(0)
  })
  it('读不到返回 null(而不是瞎猜一个默认值)', () => {
    expect(readItemShowType('<html>nothing here</html>')).toBeNull()
  })
  it('不理会 appmsg_type——它与 item_show_type 是正交的两个维度', () => {
    // 实测存在的混合体:视频类(10002)+ 文字消息形态(10)。正文得按 10 取。
    const html = "window.appmsg_type = '10002'; item_show_type: '10' * 1,"
    expect(readItemShowType(html)).toBe(10)
  })
})

describe('kindOf', () => {
  it('已知类型映射到取正文的方式', () => {
    expect(kindOf(0)).toBe('article')
    expect(kindOf(5)).toBe('video')
    expect(kindOf(8)).toBe('picture')
    expect(kindOf(10)).toBe('text')
    expect(kindOf(11)).toBe('article')
  })
  it('没见过的类型和读不到类型都算 unknown(类型是开放集合)', () => {
    expect(kindOf(99)).toBe('unknown')
    expect(kindOf(null)).toBe('unknown')
  })
})

describe('unknownKindWarning', () => {
  it('说清「按什么处理了」,而不只是「有问题」', () => {
    expect(unknownKindWarning(99)).toContain('99')
    expect(unknownKindWarning(99)).toContain('按普通图文解析')
    expect(unknownKindWarning(null)).toContain('没有读到消息类型')
  })
})

describe('kindTag（卡片上的类型标识）', () => {
  it('普通图文与发布通告不标——默认形态标了等于没标', () => {
    expect(kindTag(0)).toBeNull()
    expect(kindTag(11)).toBeNull()
  })

  it('老文章没有 itemShowType 时不标，不能让存量文库一片警示', () => {
    expect(kindTag(null)).toBeNull()
    expect(kindTag(undefined)).toBeNull()
  })

  it('8 标「图片」而不是与默认类型同名的「图文」', () => {
    expect(kindTag(8)).toEqual({ text: '图片', warn: false })
  })

  it('视频与文字消息照常标', () => {
    expect(kindTag(5)).toEqual({ text: '视频', warn: false })
    expect(kindTag(10)).toEqual({ text: '文字', warn: false })
  })

  it('未知类型标警示态——它走的是兜底解析，最该让人看见', () => {
    expect(kindTag(99)).toEqual({ text: '未知类型', warn: true })
  })
})
