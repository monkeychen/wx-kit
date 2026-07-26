// tests/core/fetch-html.test.ts
import { videoTimeoutMs } from '../../src/core/exporter/export-video'
import { describe, it, expect } from 'vitest'
import { wrapFetchError, FETCH_TIMEOUT_MS, HTML_TIMEOUT_MS } from '../../src/core/fetch-html'

describe('wrapFetchError', () => {
  it('turns an aborted/timed-out request into a clear timeout message', () => {
    // AbortSignal.timeout 触发后 axios 抛 CanceledError(code ERR_CANCELED)
    const canceled = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', name: 'CanceledError' })
    const e = wrapFetchError(canceled, 'https://mp.weixin.qq.com/s/X')
    expect(e.message).toContain(`${FETCH_TIMEOUT_MS}ms`)
    expect(e.message).toContain('https://mp.weixin.qq.com/s/X')
  })
  it('passes through a non-cancel error unchanged', () => {
    const orig = new Error('ECONNREFUSED')
    expect(wrapFetchError(orig, 'https://x')).toBe(orig)
  })
})

describe('超时按资源体量分档', () => {
  it('文章页比图片宽松 —— 视频消息页实测 2.4MB，20 秒等于要求 120KB/s', () => {
    expect(HTML_TIMEOUT_MS).toBeGreaterThan(FETCH_TIMEOUT_MS)
    expect(HTML_TIMEOUT_MS).toBeGreaterThanOrEqual(60000)
  })
  it('图片档不能太大 —— 一篇文章的图是串行下的，单张放太宽会让整篇卡很久', () => {
    expect(FETCH_TIMEOUT_MS).toBeLessThanOrEqual(30000)
  })
  it('视频按体积算，且不低于图片档', () => {
    expect(videoTimeoutMs(139984916)).toBeGreaterThan(HTML_TIMEOUT_MS)  // 133MB → 约 700 秒
    expect(videoTimeoutMs(1024)).toBeGreaterThanOrEqual(60000)          // 小视频也给足 60 秒
    // 体积翻倍，超时也跟着翻倍（不是固定值）
    expect(videoTimeoutMs(40_000_000)).toBeGreaterThan(videoTimeoutMs(20_000_000))
  })
})
