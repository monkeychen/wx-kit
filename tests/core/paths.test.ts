// tests/core/paths.test.ts
import { describe, it, expect } from 'vitest'
import { sanitizeName, articleDirName, dedupeDirName } from '../../src/core/paths'

describe('sanitizeName', () => {
  it('removes filesystem-illegal characters', () => {
    expect(sanitizeName('a/b:c*d?e"f<g>h|i\\j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })
  it('collapses whitespace and trims', () => {
    expect(sanitizeName('  hello   world  ')).toBe('hello world')
  })
  it('truncates very long names to 80 chars', () => {
    expect(sanitizeName('x'.repeat(200)).length).toBe(80)
  })
  it('falls back to "untitled" for empty', () => {
    expect(sanitizeName('   ')).toBe('untitled')
  })
})

describe('articleDirName', () => {
  it('combines date prefix and sanitized title', () => {
    expect(articleDirName('2026-02-25', '深度/长文')).toBe('2026-02-25_深度_长文')
  })
  it('omits prefix when date empty', () => {
    expect(articleDirName('', '标题')).toBe('标题')
  })
})

describe('dedupeDirName', () => {
  it('returns base when not taken', () => {
    expect(dedupeDirName('foo', () => false)).toBe('foo')
  })
  it('appends -2, -3 until free', () => {
    const taken = new Set(['foo', 'foo-2'])
    expect(dedupeDirName('foo', n => taken.has(n))).toBe('foo-3')
  })
})
