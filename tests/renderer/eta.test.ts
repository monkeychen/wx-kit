// tests/renderer/eta.test.ts
import { describe, it, expect } from 'vitest'
import { estimateRemaining } from '../../src/renderer/eta'

describe('estimateRemaining', () => {
  it('estimates from completed count and elapsed time', () => {
    // 2 篇用了 20s → 10s/篇，剩 8 篇 → 80s
    expect(estimateRemaining(2, 10, 20000)).toBe('约剩 1 分 20 秒')
  })
  it('uses seconds when under a minute', () => {
    expect(estimateRemaining(5, 10, 25000)).toBe('约剩 25 秒')
  })
  it('is blank before first completion or when done', () => {
    expect(estimateRemaining(0, 10, 5000)).toBe('')
    expect(estimateRemaining(10, 10, 5000)).toBe('')
  })
})
