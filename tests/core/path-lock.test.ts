import { describe, it, expect } from 'vitest'
import { withPathLock } from '../../src/core/path-lock'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('withPathLock', () => {
  it('serializes calls with the same key (no interleave)', async () => {
    const order: string[] = []
    const a = withPathLock('k', async () => { order.push('a-start'); await delay(15); order.push('a-end') })
    const b = withPathLock('k', async () => { order.push('b-start'); await delay(1); order.push('b-end') })
    await Promise.all([a, b])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('lets different keys run concurrently', async () => {
    let aStarted = false, bStarted = false
    const a = withPathLock('k1', async () => { aStarted = true; await delay(10) })
    const b = withPathLock('k2', async () => { bStarted = true; await delay(10) })
    await delay(1)
    expect(aStarted && bStarted).toBe(true)
    await Promise.all([a, b])
  })

  it('a rejecting fn does not poison the next call on the same key', async () => {
    await expect(withPathLock('k', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    const ok = await withPathLock('k', async () => 42)
    expect(ok).toBe(42)
  })
})
