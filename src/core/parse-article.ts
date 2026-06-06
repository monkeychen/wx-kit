// src/core/parse-article.ts
import * as cheerio from 'cheerio'
import type { ParsedArticle } from './types'

function meta($: cheerio.CheerioAPI, prop: string): string {
  return $(`meta[property="${prop}"]`).attr('content')?.trim() ?? ''
}

export function parseArticle(html: string, _sourceUrl: string): ParsedArticle {
  const $ = cheerio.load(html)

  const title = ($('#activity-name').text().trim() || meta($, 'og:title')) ?? ''
  const account = $('#js_name').text().trim()
  const publishTime = $('#publish_time').text().trim()
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
    author: account,
    account,
    publishTime,
    digest,
    coverUrl,
    contentHtml: $content.html() ?? '',
    imageUrls,
  }
}
