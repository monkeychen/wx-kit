// tests/core/article-keys.test.ts
import { describe, it, expect } from 'vitest'
import { extractArticleKeys } from '../../src/core/article-keys'

// 2026-08-26 真实抓取雷一言文章页确认的脚本形态（3.2MB 页面中的关键行）
const REAL_PAGE = `
  var biz = "MzYzNDg1MDcyNQ==" || '';
  var mid = "2247486019";
  var idx = "1";
  var msg_daily_idx = "1";
`

describe('extractArticleKeys', () => {
  it('真实脚本形态：biz/mid/idx 全部提取', () => {
    const k = extractArticleKeys(REAL_PAGE)
    expect(k.biz).toBe('MzYzNDg1MDcyNQ==')
    expect(k.mid).toBe('2247486019')
    expect(k.idx).toBe('1')
  })
  it('空串形态视为缺失（真实页面里 var mid = "" 存在）', () => {
    const k = extractArticleKeys('var biz = ""; var mid = ""; var idx = "";')
    expect(k.biz).toBeUndefined()
    expect(k.mid).toBeUndefined()
    expect(k.idx).toBeUndefined()
  })
  it('不误读 msg_daily_idx 等近似变量', () => {
    const k = extractArticleKeys('var msg_daily_idx = "9"; var idx = "2";')
    expect(k.idx).toBe('2')
    expect((k as Record<string, unknown>)['msg_daily_idx']).toBeUndefined()
  })
  it('mid/idx 只认数字串（防误读其它脚本的字符串值）', () => {
    const k = extractArticleKeys('var mid = "abc"; var idx = "1x";')
    expect(k.mid).toBeUndefined()
    expect(k.idx).toBeUndefined()
  })
  it('页面里没有脚本变量 → 空对象', () => {
    expect(extractArticleKeys('<html><body>裸页面</body></html>')).toEqual({})
  })
})
