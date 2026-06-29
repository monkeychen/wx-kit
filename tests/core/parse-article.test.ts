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
  it('extracts byline author distinct from account', () => {
    expect(a.author).toBe('某位作者')
    expect(a.author).not.toBe(a.account)
  })
  it('collects unique image urls in order from data-src', () => {
    expect(a.imageUrls).toEqual(['https://mmbiz.qpic.cn/img_a', 'https://mmbiz.qpic.cn/img_b', 'https://mmbiz.qpic.cn/img_c'])
  })
  it('keeps content html non-empty', () => expect(a.contentHtml).toContain('第一段正文'))
})

describe('parseArticle publishTime fallback', () => {
  // 真实微信页：#publish_time 元素为空（运行时 JS 填充），时间藏在脚本变量里
  it('falls back to the human-readable createTime var when #publish_time is empty', () => {
    const html =
      '<h1 id="activity-name">x</h1><div id="js_content"><p>正文</p></div>' +
      '<script>var oriCreateTime = \'1779415680\';createTime = \'2026-05-22 10:08\';var ct = "1779415680";</script>'
    expect(parseArticle(html, 'x').publishTime).toBe('2026-05-22 10:08')
  })
  it('falls back to a unix timestamp var (Asia/Shanghai) when no readable createTime', () => {
    const html =
      '<h1 id="activity-name">x</h1><div id="js_content"><p>正文</p></div>' +
      '<script>var ct = "1779415680";</script>'
    expect(parseArticle(html, 'x').publishTime).toBe('2026-05-22 10:08')
  })
})

describe('parseArticle account fallback', () => {
  // 真实微信页：#js_name 元素为空（运行时 JS 填充），账号名藏在脚本变量 d.nick_name 里。
  // 形态：d.nick_name = (xml ? getXmlValue('nick_name.DATA') : '公众号名').html(false)
  it('falls back to the d.nick_name script var when #js_name is empty', () => {
    const html =
      '<h1 id="activity-name">x</h1><div id="js_content"><p>正文</p></div>' +
      "<script>var d = {};\n  d.nick_name = (xml ? getXmlValue('nick_name.DATA') : '刘备教授').html(false);</script>"
    expect(parseArticle(html, 'x').account).toBe('刘备教授')
  })
  it('ignores unrelated nick_name occurrences (comments/game profile)', () => {
    // 评论区/游戏资料里也有 nick_name，但不是 d.nick_name = (...) 形态，不应误取
    const html =
      '<h1 id="activity-name">x</h1><div id="js_content"><p>正文</p></div>' +
      "<script>if (user_game_profile.user_info.nick_name) {}\n" +
      "  d.nick_name = (xml ? getXmlValue('nick_name.DATA') : '正确账号').html(false);</script>"
    expect(parseArticle(html, 'x').account).toBe('正确账号')
  })
  it('still prefers #js_name element text when present', () => {
    const html =
      '<span id="js_name">实时账号</span><h1 id="activity-name">x</h1><div id="js_content"><p>正文</p></div>' +
      "<script>d.nick_name = (xml ? '' : '脚本账号').html(false);</script>"
    expect(parseArticle(html, 'x').account).toBe('实时账号')
  })
})
