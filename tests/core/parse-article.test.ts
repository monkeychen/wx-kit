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

describe('parseArticle text message (item_show_type 10)', () => {
  // 文字消息：无标题、无 #js_content，正文在脚本变量 text_page_info.content（\x0a 转义），
  // og:title 被微信塞入整篇正文（换行为字面 \n）——不可用作标题
  const html = readFileSync(join(__dirname, '../fixtures/text-message.html'), 'utf-8')
  const a = parseArticle(html, 'https://mp.weixin.qq.com/s/SF5PlWYTHiuHqWYmFmKh9Q')

  it('derives title from first line of content, truncated to 30 chars + ellipsis', () => {
    expect(a.title).toBe('先向佛得角致敬，但我婷这阵容实在是不行，除了梅老板以外，连个…')
  })
  it('title contains no literal escape sequences', () => {
    expect(a.title).not.toContain('\\n')
    expect(a.title).not.toContain('\\x0a')
  })
  it('builds paragraph contentHtml from script var with \\x0a unescaped', () => {
    expect((a.contentHtml.match(/<p>/g) ?? []).length).toBe(12)
    expect(a.contentHtml).toContain('<p>就这些了。</p>')
    expect(a.contentHtml).not.toContain('\\x0a')
  })
  it('has no images', () => expect(a.imageUrls).toEqual([]))
  it('keeps account/publishTime fallbacks working', () => {
    expect(a.account).toBe('刘备教授')
    expect(a.publishTime).toBe('2026-07-04 08:45')
  })
})

describe('parseArticle picture message (item_show_type 8)', () => {
  // 图文消息/小绿书：无 #js_content，正文在 cgiDataNew.content_noencode，
  // 图片在 window.picture_page_info_list（须排除 watermark_info/share_cover/空 URL）
  const html = readFileSync(join(__dirname, '../fixtures/picture-message.html'), 'utf-8')
  const a = parseArticle(html, 'https://mp.weixin.qq.com/s/2enR9fGb9oQ0edZlplkVxA')

  it('keeps og:title as title', () => expect(a.title).toBe('有海鸥还看什么A股行情...'))
  it('extracts text paragraphs from content_noencode', () => {
    expect(a.contentHtml).toContain('<p>被海鸥圈粉了，原以为7个小时没有网络的日光会很无聊。</p>')
    expect(a.contentHtml).toContain('<p>只能接着格局了...</p>')
  })
  it('extracts main images only (no watermark/share_cover/empty urls)', () => {
    expect(a.imageUrls).toHaveLength(3)
    expect(a.imageUrls[0]).toContain('z2nn89urdvFjVQoW2t5WYlO3Yk3faictC')
    expect(a.imageUrls[1]).toContain('z2nn89urdvFYuu7HnDxqQUqEUUljbOKG')
    expect(a.imageUrls[2]).toContain('z2nn89urdvGITMmFzTSqlWcnu253Ew57')
    // 水印图与分享封面不得混入
    expect(a.imageUrls.join()).not.toContain('z2nn89urdvFzVGCxI3gxg0AcLvwv3E9u')
    expect(a.imageUrls.join()).not.toContain('z2nn89urdvEBibxqQhq2HstyxmyKf7hV1')
  })
  it('appends images to contentHtml as <img data-src> (localizer-compatible)', () => {
    expect((a.contentHtml.match(/<img data-src=/g) ?? []).length).toBe(3)
  })
  it('cleans literal \\x0a out of digest', () => {
    expect(a.digest).toContain('被海鸥圈粉了')
    expect(a.digest).not.toContain('\\x0a')
  })
  it('keeps account fallback working', () => expect(a.account).toBe('聊哉梦呓'))
})

describe('parseArticle script-content edge cases', () => {
  it('unescapes \\xNN/\\uNNNN/quotes and escapes html specials in paragraphs', () => {
    const html = "<script>text_page_info: {\n content: 'A\\x26B \\'q\\' <tag> \\u597d',</script>"
    const a = parseArticle(html, 'x')
    expect(a.contentHtml).toBe("<p>A&amp;B 'q' &lt;tag&gt; 好</p>")
  })
  it('does not append ellipsis when first line is within 30 chars', () => {
    const html = "<script>text_page_info: {\n content: '短标题\\x0a这里是正文',</script>"
    const a = parseArticle(html, 'x')
    expect(a.title).toBe('短标题')
    expect((a.contentHtml.match(/<p>/g) ?? []).length).toBe(2)
  })
  it('cleans literal \\n out of og:title fallback', () => {
    const html = '<meta property="og:title" content="第一行\\n\\n第二行" /><div id="js_content"><p>正文</p></div>'
    expect(parseArticle(html, 'x').title).toBe('第一行 第二行')
  })
  it('leaves error pages (no content anywhere) with empty title for invalid-article detection', () => {
    const html = '<div class="weui-msg"><p>该内容已被发布者删除</p></div>'
    const a = parseArticle(html, 'x')
    expect(a.title).toBe('')
    expect(a.contentHtml).toBe('')
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

describe('parseArticle video message (appmsg_type 10002)', () => {
  // 视频消息页：整页内容 = 标题 + 描述 + 视频，没有 rich_media_content。
  // 陷阱：这类页面**有** #js_content，但它是「分享提示」空壳（含大段内联 script），
  // 于是 M19 建立的「#js_content 为空才走脚本变量」分流被跳过，
  // 旧实现直接把那个壳当正文 → contentHtml 是 21.8 万字符的 JavaScript。
  const html = readFileSync(join(__dirname, '../fixtures/video-message.html'), 'utf-8')
  const a = parseArticle(html, 'https://mp.weixin.qq.com/s/bXUTSRQ_zIvyigWiqw3UfA')

  it('正文不再是内联脚本垃圾', () => {
    expect(a.contentHtml).not.toContain('<script')
    expect(a.contentHtml).not.toContain('__INLINE_SCRIPT__')
    expect(a.contentHtml.length).toBeLessThan(2000)
  })
  it('正文取 content_noencode 的描述文字，段落形态', () => {
    expect(a.contentHtml).toContain('<p>Anthropic Claude 平台的三位负责人聊了 Agent 基础设施的最新变化')
  })
  it('标题/公众号/时间/封面不回归', () => {
    expect(a.title).toBe('构建未来的 Agent 基础设施')
    expect(a.account).toBe('宝玉AI')
    expect(a.publishTime).toBe('2026-07-12 13:20')
    expect(a.coverUrl).toContain('mmbiz.qpic.cn')
  })
  it('带出视频源（择最高清档）', () => {
    expect(a.videos).toHaveLength(1)
    expect(a.videos[0].formatId).toBe('10002')
  })
  it('普通文章的 videos 是空数组', () => {
    const plain = readFileSync(join(__dirname, '../fixtures/sample-article.html'), 'utf-8')
    expect(parseArticle(plain, 'x').videos).toEqual([])
  })
})

describe('parseArticle 按消息类型分发(M36)', () => {
  const videoHtml = readFileSync(join(__dirname, '../fixtures/video-message.html'), 'utf-8')

  it('带出 itemShowType,普通文章无告警', () => {
    const a = parseArticle(readFileSync(join(__dirname, '../fixtures/sample-article.html'), 'utf-8'), 'x')
    expect(a.warnings).toEqual([])
  })

  it('未识别的类型:按图文兜底,但必须出声(不能静默产出垃圾)', () => {
    const html = "<html><body><div id=\"js_content\"><p>正文</p></div>" +
      "<script>item_show_type: '77' * 1,</script></body></html>"
    const a = parseArticle(html, 'x')
    expect(a.itemShowType).toBe(77)
    expect(a.contentHtml).toContain('正文')          // 兜底仍要出内容
    expect(a.warnings.join()).toContain('未识别的消息类型 77')
  })

  it('读不到类型但正文正常 → 不告警(按图文处理本来就对,报了只是噪音)', () => {
    const a = parseArticle('<html><body><div id="js_content"><p>正文</p></div></body></html>', 'x')
    expect(a.itemShowType).toBeNull()
    expect(a.warnings).toEqual([])
  })

  it('读不到类型且正文也空 → 告警(这才是真的不知道怎么办)', () => {
    const a = parseArticle('<html><body><div id="js_content"></div></body></html>', 'x')
    expect(a.warnings.join()).toContain('没有读到消息类型')
  })

  it('正文疑似整页脚本时告警(类型判对但页面改版的信号)', () => {
    const junk = '<script>' + 'x'.repeat(25000) + '</script>'
    const html = `<html><body><div id="js_content">${junk}</div><script>item_show_type: '0' * 1,</script></body></html>`
    expect(parseArticle(html, 'x').warnings.join()).toContain('正文疑似包含页面脚本')
  })

  it('视频消息(5)照旧走描述文字,不回归', () => {
    const a = parseArticle(videoHtml, 'x')
    expect(a.itemShowType).toBe(5)
    expect(a.contentHtml).not.toContain('<script')
    expect(a.videos).toHaveLength(1)
    expect(a.warnings).toEqual([])
  })
})
