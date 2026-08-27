// src/core/parse-article.ts
import * as cheerio from 'cheerio'
import type { ParsedArticle } from './types'
import { extractMpVideos } from './parse-video'
import { kindOf, readItemShowType, unknownKindWarning, type MessageKind } from './message-kind'

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
 * （v0.10.0 起导出：search --url 识别账号时单独使用，不必跑整个 parseArticle。）
 */
export function parseAccount($: cheerio.CheerioAPI, html: string): string {
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
function extractContentNoencode(html: string): string {
  const c = html.match(new RegExp(`content_noencode:\\s*'${JS_STR}'`))
  return c ? unescapeJsString(c[1]).trim() : ''
}

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
  return { content: extractContentNoencode(html), imageUrls }
}

export function parseArticle(html: string, _sourceUrl: string): ParsedArticle {
  const $ = cheerio.load(html)

  let title = $('#activity-name').text().trim() || cleanMetaText(meta($, 'og:title'))
  const account = parseAccount($, html)
  const author = $('#js_author_name').text().trim() || account
  const publishTime = parsePublishTime($, html)
  const digest = cleanMetaText(meta($, 'og:description'))
  const coverUrl = meta($, 'og:image')

  // 视频与类型无关:它是附加内容(和图片同级),有就取——
  // 例如「文字消息(10) + 带视频」的混合体,正文按文字消息取,视频照样要下。
  const videos = extractMpVideos(html)

  const itemShowType = readItemShowType(html)
  const kind = kindOf(itemShowType)
  const warnings: string[] = []

  const $content = $('#js_content')
  // 微信图片真实地址在 data-src
  const imageUrls: string[] = []
  $content.find('img').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src')
    if (src && !imageUrls.includes(src)) imageUrls.push(src)
  })

  // 按类型取正文。不认识的类型走 article 兜底,但**必须出声**——
  // 静默兜底正是「21.8 万字符 JS 当正文」那个 bug 能一路绿灯的原因。
  let contentHtml = ''
  const fromJsContent = () => {
    const h = $content.html() ?? ''
    // 类型判对了但页面结构变了也要能发现:正文里出现大段脚本就是信号
    if (h.includes('<script') && h.length > 20000) {
      warnings.push('正文疑似包含页面脚本(可能是未适配的消息类型),建议核对该篇 content.md。')
    }
    return h
  }
  const fromTextMessage = (): string => {
    const text = extractTextMessageContent(html)
    if (!text) return ''
    // 文字消息无标题,og:title 被塞入整篇正文 → 从正文首行生成短标题
    title = titleFromText(text)
    return textToParagraphs(text)
  }
  const fromPictureMessage = (): string => {
    const pic = extractPictureMessage(html)
    if (!pic.imageUrls.length) return ''
    imageUrls.push(...pic.imageUrls)
    return [textToParagraphs(pic.content), ...pic.imageUrls.map((u) => `<p><img data-src="${u}"></p>`)]
      .filter(Boolean).join('\n')
  }
  const byKind: Record<MessageKind, () => string> = {
    article: fromJsContent,
    text: fromTextMessage,
    picture: fromPictureMessage,
    video: () => textToParagraphs(extractContentNoencode(html)),
    unknown: fromJsContent,
  }
  contentHtml = byKind[kind]()
  // 告警要挑准时机,否则会变成噪音、被无视:
  //  · 认不出的**具体类型号** → 一定说(我们确实没适配它)
  //  · 压根读不到类型,但 #js_content 有正常正文 → 不说(按图文处理本来就对)
  if (kind === 'unknown' && (itemShowType != null || !contentHtml.trim())) {
    warnings.push(unknownKindWarning(itemShowType))
  }

  // 认识的类型也可能取空(页面改版/字段挪位):退回旧的启发式链兜底,同样出声
  if (!contentHtml.trim() && kind !== 'article') {
    const fallback = fromTextMessage() || fromPictureMessage() || fromJsContent()
    if (fallback.trim()) {
      warnings.push(`消息类型 ${itemShowType} 的常规解析取不到正文,已用兜底方式提取,建议核对。`)
      contentHtml = fallback
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
    videos,
    itemShowType,
    warnings,
  }
}
