// tests/electron/subscription-check.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Subscriptions } from '../../src/core/subscriptions'
import { runSubscriptionCheck } from '../../electron/services/subscription-check'
import { MpAuthExpired } from '../../src/core/mp-errors'

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

  it('failed accounts carry per-account failure details (nickname + error) into log and result', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: '猫笔刀', watermark: 100 }, { fakeid: 'f2', nickname: 'B', watermark: 100 }])
    const check = vi.fn(async () => [
      { fakeid: 'f1', ok: false, latest: 100, newRefs: [], error: '微信频率限制（200013）' },
      { fakeid: 'f2', ok: true, latest: 100, newRefs: [] },
    ])
    const log = vi.fn()
    const r = await runSubscriptionCheck('auto', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(), log, check: check as never,
    })
    const expected = [{ nickname: '猫笔刀', error: '微信频率限制（200013）' }]
    expect(r).toMatchObject({ failed: 1, failures: expected })
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ failed: 1, failures: expected }))
  })

  it('all-success check logs no failures field (old entries stay clean)', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 100 }])
    const check = vi.fn(async () => [{ fakeid: 'f1', ok: true, latest: 100, newRefs: [] }])
    const log = vi.fn()
    await runSubscriptionCheck('auto', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(), log, check: check as never,
    })
    expect(log.mock.calls[0][0]).not.toHaveProperty('failures')
  })

  it('auth-expired → note auth-expired, authExpired true, failed = accounts count, downloadRefs not called', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 0 }])
    const downloadRefs = vi.fn()
    const check = vi.fn(async () => { throw new MpAuthExpired('登录态失效') })
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs, log: vi.fn(), check: check as never,
    })
    expect(r).toMatchObject({ note: 'auth-expired', authExpired: true, failed: 1 })
    expect(downloadRefs).not.toHaveBeenCalled()
  })
})
