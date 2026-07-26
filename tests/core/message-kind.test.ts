// tests/core/message-kind.test.ts
import { describe, it, expect } from 'vitest'
import { readItemShowType, kindOf, unknownKindWarning } from '../../src/core/message-kind'

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
