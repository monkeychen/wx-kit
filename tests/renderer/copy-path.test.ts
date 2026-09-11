// tests/renderer/copy-path.test.ts
import { describe, it, expect } from 'vitest'
import { copyPathText, cardMenuItems } from '../../src/renderer/copy-path'
import type { ArticleMeta } from '../../src/core/types'

const mk = (over: Partial<ArticleMeta>): ArticleMeta => ({
  id: over.id ?? 'i', title: '', author: '', account: '', publishTime: '', sourceUrl: '',
  digest: '', coverUrl: '', downloadTime: '', formats: [], dir: '', ...over,
})

describe('copyPathText', () => {
  it('返回该篇 meta.dir 本身（文本来源只认 meta，与任何选中集无关）', () => {
    const a = mk({ id: 'a', dir: '/Users/a/Documents/wx-kit/2026-09-11-foo' })
    const b = mk({ id: 'b', dir: '/Users/a/Documents/wx-kit/2026-09-10-bar' })
    expect(copyPathText(a)).toBe(a.dir)
    expect(copyPathText(b)).toBe(b.dir)   // 两篇各自独立 → 多选不串
  })
})

describe('cardMenuItems', () => {
  it('含 复制路径，且四个动作齐全', () => {
    const items = cardMenuItems(true)
    expect(items.map((i) => i.key)).toEqual(['read', 'reveal', 'copy-path', 'delete'])
    expect(items.find((i) => i.key === 'copy-path')?.label).toBe('复制路径')
  })
  it('不可读文章 read 项 disabled', () => {
    expect(cardMenuItems(false).find((i) => i.key === 'read')?.disabled).toBe(true)
    expect(cardMenuItems(true).find((i) => i.key === 'read')?.disabled).toBeFalsy()
  })
})
