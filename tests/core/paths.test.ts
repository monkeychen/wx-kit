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
  it('does not split surrogate pairs when truncating', () => {
    const out = sanitizeName('x'.repeat(79) + '😀😀')
    // no lone surrogate: re-encoding round-trips cleanly
    expect([...out].every(ch => ch.codePointAt(0)! <= 0xFFFF || ch.length === 2)).toBe(true)
    expect([...out].length).toBeLessThanOrEqual(80)
  })
  it('leaves no trailing space after truncation', () => {
    const out = sanitizeName('a'.repeat(79) + ' bc')
    expect(out).toBe(out.trimEnd())
  })
  it('keeps exactly-80 input untruncated', () => {
    const s = 'a'.repeat(80)
    expect(sanitizeName(s)).toBe(s)
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
