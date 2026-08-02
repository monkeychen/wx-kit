// src/core/fetch-html.ts
import axios from 'axios'

/**
 * 单个请求的硬上限（毫秒）。用 AbortSignal 兜底，覆盖连接/代理握手阶段。
 *
 * 按资源实际体量分档 —— 一个固定值同时服务「几十 KB 的图」和「几 MB 的页面」必然有一头不合适:
 *   · 文章页可以很大:视频消息页实测 2.4MB,20 秒等于要求跑满 120KB/s,慢一点就整篇失败
 *     (M35/M36 真实抓取时遇到过一次这样的偶发失败)
 *   · 图片通常几百 KB,给 30 秒已很宽松;而且一篇文章的图是**串行**下载的,
 *     单张超时值放太大会让「整篇图都拉不动」的情况卡上几十分钟
 *   · 视频动辄上百 MB,固定值根本没意义 → 按体积算,见 exporter/export-video.ts 的 videoTimeoutMs
 */
export const FETCH_TIMEOUT_MS = 30000
/** 文章页:2.4MB 的页面在 40KB/s 下也能下完 */
export const HTML_TIMEOUT_MS = 60000

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

/**
 * 通用二进制下载（当前仅用于 GitHub 安装包），返回 buffer 与内容类型。
 * 微信文章/图片/视频不得调用这里，统一走 Chromium MpRequestGateway。
 * `timeoutMs` 可覆盖默认值：默认档对图片够用，但**视频完全不够**——
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
    })
    return { data: Buffer.from(res.data), contentType: String(res.headers['content-type'] ?? '') }
  } catch (e) {
    throw wrapFetchError(e, url, timeoutMs)
  }
}
