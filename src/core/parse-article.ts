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

export function parseArticle(html: string, _sourceUrl: string): ParsedArticle {
  const $ = cheerio.load(html)

  const title = $('#activity-name').text().trim() || meta($, 'og:title')
  const account = $('#js_name').text().trim()
  const author = $('#js_author_name').text().trim() || account
  const publishTime = parsePublishTime($, html)
  const digest = meta($, 'og:description')
  const coverUrl = meta($, 'og:image')

  const $content = $('#js_content')
  // 微信图片真实地址在 data-src
  const imageUrls: string[] = []
  $content.find('img').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src')
    if (src && !imageUrls.includes(src)) imageUrls.push(src)
  })

  return {
    title,
    author,
    account,
    publishTime,
    digest,
    coverUrl,
    contentHtml: $content.html() ?? '',
    imageUrls,
  }
}
