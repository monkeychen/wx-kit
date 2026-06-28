// tests/electron/subscription-check.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Subscriptions } from '../../src/core/subscriptions'
import { runSubscriptionCheck } from '../../electron/services/subscription-check'

const newSubs = async (accs: Array<{ fakeid: string; nickname: string; watermark: number }>) => {
  const subs = new Subscriptions(mkdtempSync(join(tmpdir(), 'wxk-subchk-')))
  for (const a of accs) await subs.addAccount({ ...a, subscribed: true })
  return subs
}

describe('runSubscriptionCheck', () => {
  it('no session → note no-session, authExpired true, no download', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 0 }])
    const downloadRefs = vi.fn()
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: null, mpFetch: null, downloadRefs, log: vi.fn(),
    })
    expect(r).toMatchObject({ note: 'no-session', authExpired: true })
    expect(downloadRefs).not.toHaveBeenCalled()
  })

  it('notify mode stores newRefs and advances watermark', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 100 }])
    const check = vi.fn(async () => [{ fakeid: 'f1', ok: true, latest: 200, newRefs: [{ title: 'n', url: 'u', createTime: 200 }] }])
    const downloadRefs = vi.fn()
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs, log: vi.fn(), check: check as never,
    })
    expect(r).toMatchObject({ accounts: 1, newFound: 1, failed: 0, authExpired: false })
    expect(downloadRefs).not.toHaveBeenCalled()
    expect((await subs.list())[0]).toMatchObject({ watermark: 200, newRefs: [{ url: 'u' }] })
  })

  it('download mode calls downloadRefs and clears newRefs', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 100 }])
    const check = vi.fn(async () => [{ fakeid: 'f1', ok: true, latest: 200, newRefs: [{ title: 'n', url: 'u', createTime: 200 }] }])
    const downloadRefs = vi.fn(async () => {})
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs, log: vi.fn(), check: check as never,
    })
    expect(r).toMatchObject({ newFound: 1 })
    expect(downloadRefs).toHaveBeenCalledOnce()
    expect((await subs.list())[0].newRefs).toEqual([])
  })
})
