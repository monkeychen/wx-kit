// tests/core/mowen/url.test.ts
import { describe, it, expect } from 'vitest'
import { isMowenNoteUrl, extractMowenNoteId } from '../../../src/core/mowen/url'

describe('isMowenNoteUrl', () => {
  it('识别 note.mowen.cn/detail/<id>', () => {
    expect(isMowenNoteUrl('https://note.mowen.cn/detail/sR7--cPyh93LY0inGk2yX')).toBe(true)
    expect(isMowenNoteUrl('https://note.mowen.cn/detail/Ni2ZIpWVBtm1qu8sAmihb?from=mocli')).toBe(true)
    expect(isMowenNoteUrl('http://note.mowen.cn/detail/sR7--cPyh93LY0inGk2yX')).toBe(true)
  })
  it('微信 URL / 用户主页 / 裸 id / 空串都不是详情页 URL', () => {
    expect(isMowenNoteUrl('https://mp.weixin.qq.com/s/ABC')).toBe(false)
    expect(isMowenNoteUrl('https://note.mowen.cn/user/4L8RrxEaExmHJOf9xrGLo')).toBe(false)
    expect(isMowenNoteUrl('sR7--cPyh93LY0inGk2yX')).toBe(false)
    expect(isMowenNoteUrl('')).toBe(false)
  })
})

describe('extractMowenNoteId', () => {
  it('从完整 URL（含 query）提取 id', () => {
    expect(extractMowenNoteId('https://note.mowen.cn/detail/sR7--cPyh93LY0inGk2yX?from=mocli')).toBe('sR7--cPyh93LY0inGk2yX')
  })
  it('接受裸 noteId（20-24 位 [A-Za-z0-9_-]）', () => {
    expect(extractMowenNoteId('Ni2ZIpWVBtm1qu8sAmihb')).toBe('Ni2ZIpWVBtm1qu8sAmihb')
    expect(extractMowenNoteId('  sR7--cPyh93LY0inGk2yX  ')).toBe('sR7--cPyh93LY0inGk2yX')
  })
  it('过短 id、微信 URL、空串 → null', () => {
    expect(extractMowenNoteId('short-id-123')).toBeNull()
    expect(extractMowenNoteId('https://mp.weixin.qq.com/s/ABC')).toBeNull()
    expect(extractMowenNoteId('')).toBeNull()
  })
})
