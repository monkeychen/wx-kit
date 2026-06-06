// src/core/fetch-html.ts
import axios from 'axios'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export async function fetchHtml(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    timeout: 20000,
    responseType: 'text',
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
  })
  return res.data
}

/** 下载二进制资源（图片/封面），返回 buffer 与内容类型 */
export async function fetchBinary(url: string): Promise<{ data: Buffer; contentType: string }> {
  const res = await axios.get<ArrayBuffer>(url, {
    timeout: 20000,
    responseType: 'arraybuffer',
    headers: { 'User-Agent': UA, Referer: 'https://mp.weixin.qq.com/' },
  })
  return { data: Buffer.from(res.data), contentType: String(res.headers['content-type'] ?? '') }
}
