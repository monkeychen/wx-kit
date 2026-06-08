// tests/core/fetch-html.test.ts
import { describe, it, expect } from 'vitest'
import { wrapFetchError, FETCH_TIMEOUT_MS } from '../../src/core/fetch-html'

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
