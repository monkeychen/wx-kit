// tests/core/weread/book-id.test.ts
import { describe, it, expect } from 'vitest'
import { digitsFromBiz, bizFromDigits, normalizeAccountId, digitsOfBookId } from '../../../src/core/weread/book-id'

describe('digitsFromBiz / bizFromDigits', () => {
  // 2026-08-26 用真实文章页实测的三方换算（雷一言）
  it('base64 biz ⇄ 数字 ID 往返', () => {
    expect(digitsFromBiz('MzYzNDg1MDcyNQ==')).toBe('3634850725')
    expect(bizFromDigits('3634850725')).toBe('MzYzNDg1MDcyNQ==')
  })
  it('容忍缺 padding', () => {
    expect(digitsFromBiz('MzYzNDg1MDcyNQ')).toBe('3634850725')
  })
  it('解码结果不是数字 → 报错（不静默产出坏 bookId）', () => {
    expect(() => digitsFromBiz(Buffer.from('hello').toString('base64'))).toThrow()
  })
  it('空串 → 报错', () => {
    expect(() => digitsFromBiz('')).toThrow()
    expect(() => digitsFromBiz('  ')).toThrow()
  })
})

describe('normalizeAccountId（历史形态归一）', () => {
  it('老订阅的 base64 fakeid → bookId（无需迁移 subscriptions.json）', () => {
    expect(normalizeAccountId('MzYzNDg1MDcyNQ==')).toBe('MP_WXS_3634850725')
  })
  it('缺 padding 的老 fakeid 同样认得', () => {
    expect(normalizeAccountId('MzYzNDg1MDcyNQ')).toBe('MP_WXS_3634850725')
  })
  it('已是 bookId → 原样通过', () => {
    expect(normalizeAccountId('MP_WXS_3634850725')).toBe('MP_WXS_3634850725')
  })
  it('纯数字 → 补前缀', () => {
    expect(normalizeAccountId('3634850725')).toBe('MP_WXS_3634850725')
  })
  it('MP_WXS_ 后不是数字 → 报错', () => {
    expect(() => normalizeAccountId('MP_WXS_abc')).toThrow()
  })
  it('digitsOfBookId 取数字段', () => {
    expect(digitsOfBookId('MP_WXS_3634850725')).toBe('3634850725')
  })
})
