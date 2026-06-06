// tests/core/parse-article.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArticle } from '../../src/core/parse-article'

const html = readFileSync(join(__dirname, '../fixtures/sample-article.html'), 'utf-8')

describe('parseArticle', () => {
  const a = parseArticle(html, 'https://mp.weixin.qq.com/s?mid=1&idx=1&sn=x')

  it('extracts title', () => expect(a.title).toBe('测试标题：第一性原理'))
  it('extracts account', () => expect(a.account).toBe('测试公众号'))
  it('extracts publish time', () => expect(a.publishTime).toBe('2026-02-25 08:00'))
  it('extracts digest', () => expect(a.digest).toBe('这是摘要内容'))
  it('extracts cover url', () => expect(a.coverUrl).toBe('https://mmbiz.qpic.cn/cover_123'))
  it('collects unique image urls in order from data-src', () => {
    expect(a.imageUrls).toEqual(['https://mmbiz.qpic.cn/img_a', 'https://mmbiz.qpic.cn/img_b'])
  })
  it('keeps content html non-empty', () => expect(a.contentHtml).toContain('第一段正文'))
})
