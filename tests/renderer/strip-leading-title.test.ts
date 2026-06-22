import { describe, it, expect } from 'vitest'
import { stripLeadingTitle } from '../../src/renderer/strip-leading-title'

describe('stripLeadingTitle', () => {
  it('removes the leading H1 that duplicates the title (buildMarkdown injects it)', () => {
    const md = '# 我的文章\n\n正文第一段。'
    expect(stripLeadingTitle(md, '我的文章')).toBe('正文第一段。')
  })

  it('tolerates leading blank lines before the title H1', () => {
    const md = '\n\n# 标题\n\n正文。'
    expect(stripLeadingTitle(md, '标题')).toBe('正文。')
  })

  it('keeps a leading H1 that is NOT the title (genuine body heading)', () => {
    const md = '# 第一节\n\n正文。'
    expect(stripLeadingTitle(md, '我的文章')).toBe('# 第一节\n\n正文。')
  })

  it('keeps the title heading if it is not at the very top', () => {
    const md = '引言。\n\n# 我的文章\n\n正文。'
    expect(stripLeadingTitle(md, '我的文章')).toBe('引言。\n\n# 我的文章\n\n正文。')
  })

  it('matches the raw (unescaped) title even with special chars', () => {
    const md = '# A *B* [C]\n\n正文。'
    expect(stripLeadingTitle(md, 'A *B* [C]')).toBe('正文。')
  })

  it('returns input unchanged when there is no leading H1', () => {
    const md = '正文直接开始。'
    expect(stripLeadingTitle(md, '我的文章')).toBe('正文直接开始。')
  })

  it('normalises CRLF when detecting the leading title', () => {
    const md = '# 标题\r\n\r\n正文。'
    expect(stripLeadingTitle(md, '标题')).toBe('正文。')
  })
})
