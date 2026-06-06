// src/core/image-localizer.ts
import * as cheerio from 'cheerio'

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
}

function extFromType(t: string): string {
  return EXT_BY_TYPE[t.split(';')[0].trim().toLowerCase()] ?? 'jpg'
}

/** 给定图片 URL 列表与"取内容类型"函数，产出 url -> 本地相对路径 的映射 */
export function buildImageMap(urls: string[], typeOf: (url: string) => string): Map<string, string> {
  const map = new Map<string, string>()
  urls.forEach((url, i) => {
    map.set(url, `images/img-${i + 1}.${extFromType(typeOf(url))}`)
  })
  return map
}

/** 把正文 HTML 中的 data-src/src 改写为本地相对路径 */
export function rewriteImageRefs(contentHtml: string, map: Map<string, string>): string {
  const $ = cheerio.load(contentHtml, null, false)
  $('img').each((_, el) => {
    const orig = $(el).attr('data-src') || $(el).attr('src')
    const local = orig ? map.get(orig) : undefined
    if (local) {
      $(el).attr('src', local)
      $(el).removeAttr('data-src')
    }
  })
  return $.html()
}
