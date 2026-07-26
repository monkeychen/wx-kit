// src/core/fetch-html.ts
import axios from 'axios'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** 单个请求的硬上限（毫秒）。用 AbortSignal 兜底，覆盖连接/代理握手阶段。 */
export const FETCH_TIMEOUT_MS = 20000

/**
 * 把请求异常归一化。axios 的 `timeout` 只在 socket 连上之后才计时，
 * 代理黑洞掉 CONNECT 时不触发——AbortSignal.timeout 兜住整段（含连接）。
 * 被它中止时 axios 抛 CanceledError(ERR_CANCELED)，在此翻成可读的超时信息。
 */
export function wrapFetchError(e: unknown, url: string, timeoutMs = FETCH_TIMEOUT_MS): Error {
  const code = (e as { code?: string })?.code
  const name = (e as { name?: string })?.name
  if (code === 'ERR_CANCELED' || name === 'CanceledError') {
    return new Error(`fetch timeout after ${timeoutMs}ms: ${url}`)
  }
  return e instanceof Error ? e : new Error(String(e))
}

export async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await axios.get<string>(url, {
      timeout: FETCH_TIMEOUT_MS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      responseType: 'text',
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    })
    return res.data
  } catch (e) {
    throw wrapFetchError(e, url)
  }
}

/**
 * 下载二进制资源（图片/封面/视频），返回 buffer 与内容类型。
 * `timeoutMs` 可覆盖默认值：20 秒对图片够用，但**视频完全不够**——
 * 实测 133MB 的视频在 2.66MB/s 下要 50 秒，用默认超时必然 abort（M35 踩过：
 * CLI 报 ok 但 videos 目录空的，21 秒结束正是 20 秒超时）。视频的超时按体积算，
 * 见 exporter/export-video.ts 的 videoTimeoutMs。
 */
export async function fetchBinary(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<{ data: Buffer; contentType: string }> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      timeout: timeoutMs,
      signal: AbortSignal.timeout(timeoutMs),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': UA, Referer: 'https://mp.weixin.qq.com/' },
    })
    return { data: Buffer.from(res.data), contentType: String(res.headers['content-type'] ?? '') }
  } catch (e) {
    throw wrapFetchError(e, url, timeoutMs)
  }
}
