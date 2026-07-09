// src/core/parse-article.ts
import * as cheerio from 'cheerio'
import type { ParsedArticle } from './types'

function meta($: cheerio.CheerioAPI, prop: string): string {
  return $(`meta[property="${prop}"]`).attr('content')?.trim() ?? ''
}

/** 把 Unix 毫秒格式化为微信展示的 'YYYY-MM-DD HH:mm'（北京时间） */
function formatCnTime(ms: number): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms))
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`
}

/**
 * 解析发布时间。优先读 #publish_time 文本；真实微信页该元素为空（运行时 JS 填充），
 * 时间藏在脚本变量里——回退顺序：可读的 createTime → Unix 秒(ct/oriCreateTime/createTimestamp)。
 */
function parsePublishTime($: cheerio.CheerioAPI, html: string): string {
  const fromEl = $('#publish_time').text().trim()
  if (fromEl) return fromEl
  const readable = html.match(/createTime\s*=\s*['"](\d{4}-\d{2}-\d{2} \d{2}:\d{2})['"]/)
  if (readable) return readable[1]
  const unix = html.match(/(?:\bct|oriCreateTime|createTimestamp)\s*=\s*['"](\d{10})['"]/)
  if (unix) return formatCnTime(Number(unix[1]) * 1000)
  return ''
}

/**
 * 解析公众号名。优先读 #js_name 文本；真实微信页该元素为空（运行时 JS 填充），
 * 名字藏在脚本变量里——回退读规范的 `d.nick_name = (xml ? ... : '公众号名')`，
 * 再兜底老版 `var nickname = "公众号名"`。锚定 `nick_name = (` 避开评论/游戏区里别处的 nick_name。
 */
function parseAccount($: cheerio.CheerioAPI, html: string): string {
  const fromEl = $('#js_name').text().trim()
  if (fromEl) return fromEl
  const m =
    html.match(/nick_name\s*=\s*\([^:]*:\s*'([^']*)'/) ??
    html.match(/var\s+nickname\s*=\s*"([^"]*)"/)
  return m?.[1].trim() ?? ''
}

/** 还原微信脚本里 JS 单引号字符串的转义（\x0a、\uNNNN、\'、\\ 等） */
function unescapeJsString(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_, esc: string) => {
    if (esc[0] === 'x' || esc[0] === 'u') return String.fromCharCode(parseInt(esc.slice(1), 16))
    if (esc === 'n') return '\n'
    if (esc === 'r') return '\r'
    if (esc === 't') return '\t'
    return esc
  })
}

/**
 * og meta 兜底清洗：微信会把正文塞进 og:title/og:description（文字消息尤甚），
 * 其中换行是字面 \n / \x0a 转义序列——统一替换为空格并归并空白。
 */
function cleanMetaText(s: string): string {
  return s.replace(/\\x0a|\\n|\\r|\\t/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 纯文本按空行分段包 <p>，作为规范 contentHtml 交给下游导出/阅读器 */
function textToParagraphs(text: string): string {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('\n')
}

/** 无标题消息：取正文首个非空行截 30 字作标题（与微信客户端列表展示一致） */
function titleFromText(text: string): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const chars = [...firstLine]
  return chars.length > 30 ? chars.slice(0, 30).join('') + '…' : firstLine
}

// JS 单引号字符串内容（含转义）的正则片段
const JS_STR = "((?:[^'\\\\]|\\\\[\\s\\S])*)"

/** 文字消息（item_show_type 10）：正文在脚本变量 text_page_info.content（页面由前端 JS 渲染，无 #js_content） */
function extractTextMessageContent(html: string): string {
  const m = html.match(new RegExp(`text_page_info:\\s*\\{\\s*content:\\s*'${JS_STR}'`))
  return m ? unescapeJsString(m[1]).trim() : ''
}

/**
 * 图文消息/小绿书（item_show_type 8）：正文在 cgiDataNew.content_noencode，
 * 图片在 window.picture_page_info_list。每张主图的项以 width→height→cdn_url 三连开头；
 * watermark_info/share_cover 的字段顺序不同，天然被排除。cgiDataNew 段里有零散
 * 空 URL 三连干扰，故必须先截取 window.picture_page_info_list 所在 script 段再匹配。
 */
function extractPictureMessage(html: string): { content: string; imageUrls: string[] } {
  const imageUrls: string[] = []
  const start = html.indexOf('window.picture_page_info_list')
  if (start >= 0) {
    const seg = html.slice(start, html.indexOf('</script>', start))
    const re = /width:\s*'\d+'\s*\*\s*1,\s*height:\s*'\d+'\s*\*\s*1,\s*cdn_url:\s*'([^']*)'/g
    for (const m of seg.matchAll(re)) {
      const url = unescapeJsString(m[1]).replace(/&amp;/g, '&')
      if (url && !imageUrls.includes(url)) imageUrls.push(url)
    }
  }
  if (!imageUrls.length) return { content: '', imageUrls }
  const c = html.match(new RegExp(`content_noencode:\\s*'${JS_STR}'`))
  return { content: c ? unescapeJsString(c[1]).trim() : '', imageUrls }
}

export function parseArticle(html: string, _sourceUrl: string): ParsedArticle {
  const $ = cheerio.load(html)

  let title = $('#activity-name').text().trim() || cleanMetaText(meta($, 'og:title'))
  const account = parseAccount($, html)
  const author = $('#js_author_name').text().trim() || account
  const publishTime = parsePublishTime($, html)
  const digest = cleanMetaText(meta($, 'og:description'))
  const coverUrl = meta($, 'og:image')

  const $content = $('#js_content')
  // 微信图片真实地址在 data-src
  const imageUrls: string[] = []
  $content.find('img').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src')
    if (src && !imageUrls.includes(src)) imageUrls.push(src)
  })
  let contentHtml = $content.html() ?? ''

  // 非标准消息类型：无 #js_content（页面前端渲染），正文/图片藏在脚本变量里
  if (!contentHtml.trim()) {
    const text = extractTextMessageContent(html)
    if (text) {
      // 文字消息：无标题，og:title 被塞入整篇正文 → 从正文首行生成短标题
      contentHtml = textToParagraphs(text)
      title = titleFromText(text)
    } else {
      const pic = extractPictureMessage(html)
      if (pic.imageUrls.length) {
        // 图文消息：文字段落 + 逐张主图（data-src 形态，走既有图片本地化管线）
        contentHtml = [textToParagraphs(pic.content), ...pic.imageUrls.map((u) => `<p><img data-src="${u}"></p>`)]
          .filter(Boolean)
          .join('\n')
        imageUrls.push(...pic.imageUrls)
      }
    }
  }

  return {
    title,
    author,
    account,
    publishTime,
    digest,
    coverUrl,
    contentHtml,
    imageUrls,
  }
}
