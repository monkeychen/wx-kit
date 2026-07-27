// tests/electron/subscription-check.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Subscriptions } from '../../src/core/subscriptions'
import { runSubscriptionCheck } from '../../electron/services/subscription-check'
import { MpAuthExpired } from '../../src/core/mp-errors'
import type { DownloadSummary } from '../../src/core/types'

/** downloadRefs 的桩:默认全部成功 */
const okSummary = (refs: { url: string }[] = [{ url: 'u' }]): DownloadSummary => ({
  ok: true, total: refs.length, succeeded: refs.length, failed: 0, skipped: 0,
  items: refs.map((r) => ({ url: r.url, ok: true })),
})

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
    const downloadRefs = vi.fn(async (refs: { url: string }[]) => okSummary(refs))
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs, log: vi.fn(), check: check as never,
    })
    expect(r).toMatchObject({ newFound: 1 })
    expect(downloadRefs).toHaveBeenCalledOnce()
    expect((await subs.list())[0].newRefs).toEqual([])
  })

  it('自动下载失败的文章留在待处理里等重试——此前无脑清空，失败的那篇就此消失', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 100 }])
    const refs = [
      { title: '下成功的', url: 'ok', createTime: 300 },
      { title: '网络失败的', url: 'boom', createTime: 200 },
      { title: '读者打不开的', url: 'gone', createTime: 100 },
    ]
    const check = vi.fn(async () => [{ fakeid: 'f1', ok: true, latest: 300, newRefs: refs }])
    const downloadRefs = vi.fn(async (): Promise<DownloadSummary> => ({
      ok: false, total: 3, succeeded: 1, failed: 2, skipped: 0, unavailable: 1,
      items: [
        { url: 'ok', ok: true },
        { url: 'boom', ok: false, error: { code: 'DOWNLOAD_FAILED', message: '网络错误' } },
        { url: 'gone', ok: false, unavailable: true },
      ],
    }))
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never,
      downloadRefs, log: vi.fn(), check: check as never,
    })
    expect(r.results[0].downloaded).toBe(1)                    // 报实际下成的篇数，不是「发现几篇就算下几篇」
    const left = (await subs.list())[0].newRefs
    // 真故障留着可重试；读者本就打不开的不留（重试无用，留着是永远清不掉的红点）
    expect(left.map((x) => x.title)).toEqual(['网络失败的'])
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
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log, check: check as never,
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
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log, check: check as never,
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

  it('fakeids 过滤:只查选中的号,未选中号不动(R1 部分检查)', async () => {
    const subs = await newSubs([
      { fakeid: 'f1', nickname: 'A', watermark: 100 },
      { fakeid: 'f2', nickname: 'B', watermark: 100 },
    ])
    const check = vi.fn(async (accounts: { fakeid: string }[]) =>
      accounts.map((a) => ({ fakeid: a.fakeid, ok: true, latest: 100, newRefs: [] })))
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(),
      check: check as never, fakeids: ['f2'],
    })
    expect(check).toHaveBeenCalledOnce()
    const checked = check.mock.calls[0][0] as { fakeid: string }[]
    expect(checked.map((a) => a.fakeid)).toEqual(['f2'])
    expect(r).toMatchObject({ accounts: 1 })
  })

  it('fakeids 选中的号均已退订 → note no-accounts', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 0 }])
    const check = vi.fn()
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(),
      check: check as never, fakeids: ['not-subscribed'],
    })
    expect(r).toMatchObject({ note: 'no-accounts', accounts: 0 })
    expect(check).not.toHaveBeenCalled()
  })

  // ── M34(v0.8.2 R1):逐号明细 + 自动下载进度 ──────────────────────────
  // 反馈要落在被操作的对象上,而汇总数做不到「这一行新增了几篇」,故结果必须带 per-account 明细。

  it('notify 模式:results 逐号给出 newFound,downloaded 为 0', async () => {
    const subs = await newSubs([
      { fakeid: 'f1', nickname: '甲', watermark: 100 },
      { fakeid: 'f2', nickname: '乙', watermark: 100 },
    ])
    const check = vi.fn(async () => [
      { fakeid: 'f1', ok: true, latest: 200, newRefs: [
        { title: 'a', url: 'ua', createTime: 200 }, { title: 'b', url: 'ub', createTime: 199 }] },
      { fakeid: 'f2', ok: true, latest: 100, newRefs: [] },
    ])
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(), check: check as never,
    })
    expect(r.results).toEqual([
      { fakeid: 'f1', nickname: '甲', ok: true, newFound: 2, downloaded: 0 },
      { fakeid: 'f2', nickname: '乙', ok: true, newFound: 0, downloaded: 0 },
    ])
  })

  it('download 模式:results 的 downloaded 记下自动下载了几篇', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: '甲', watermark: 100 }])
    const check = vi.fn(async () => [{ fakeid: 'f1', ok: true, latest: 200, newRefs: [
      { title: 'a', url: 'ua', createTime: 200 }, { title: 'b', url: 'ub', createTime: 199 },
      { title: 'c', url: 'uc', createTime: 198 }] }])
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(), check: check as never,
    })
    expect(r.results).toEqual([{ fakeid: 'f1', nickname: '甲', ok: true, newFound: 3, downloaded: 3 }])
  })

  it('失败号:results 带 error,且与既有 failures/failed 汇总并存(向后兼容)', async () => {
    const subs = await newSubs([
      { fakeid: 'f1', nickname: '猫笔刀', watermark: 100 },
      { fakeid: 'f2', nickname: '乙', watermark: 100 },
    ])
    const check = vi.fn(async () => [
      { fakeid: 'f1', ok: false, latest: 100, newRefs: [], error: '微信频率限制（200013）' },
      { fakeid: 'f2', ok: true, latest: 100, newRefs: [] },
    ])
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(), check: check as never,
    })
    expect(r).toMatchObject({ failed: 1, failures: [{ nickname: '猫笔刀', error: '微信频率限制（200013）' }] })
    expect(r.results).toEqual([
      { fakeid: 'f1', nickname: '猫笔刀', ok: false, newFound: 0, downloaded: 0, error: '微信频率限制（200013）' },
      { fakeid: 'f2', nickname: '乙', ok: true, newFound: 0, downloaded: 0 },
    ])
  })

  it('三条早退路径的 results 是空数组(不是 undefined,渲染层可无脑遍历)', async () => {
    const mk = (accs: Parameters<typeof newSubs>[0]) => newSubs(accs)
    // no-session
    const r1 = await runSubscriptionCheck('manual', {
      subs: await mk([{ fakeid: 'f1', nickname: 'A', watermark: 0 }]),
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: null, mpFetch: null, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(),
    })
    expect(r1.results).toEqual([])
    // no-accounts
    const r2 = await runSubscriptionCheck('manual', {
      subs: await mk([{ fakeid: 'f1', nickname: 'A', watermark: 0 }]),
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(),
      check: vi.fn() as never, fakeids: ['nope'],
    })
    expect(r2.results).toEqual([])
    // auth-expired
    const r3 = await runSubscriptionCheck('manual', {
      subs: await mk([{ fakeid: 'f1', nickname: 'A', watermark: 0 }]),
      settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(),
      check: (async () => { throw new MpAuthExpired('登录态失效') }) as never,
    })
    expect(r3.results).toEqual([])
  })

  it('自动下载会转发进度(start → 中间 → done),且带正确 fakeid', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: '甲', watermark: 100 }])
    const check = vi.fn(async () => [{ fakeid: 'f1', ok: true, latest: 200, newRefs: [
      { title: 'a', url: 'ua', createTime: 200 }, { title: 'b', url: 'ub', createTime: 199 }] }])
    // 模拟 downloadRefs 下完第一篇时回调一次进度
    const downloadRefs = vi.fn(async (refs: { url: string }[], _fmts, _src, onProgress?: (e: { completed: number; phase: string }) => void) => {
      onProgress?.({ completed: 1, phase: 'saved' })
      return okSummary(refs)
    })
    const onDownloadProgress = vi.fn()
    await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never,
      downloadRefs: downloadRefs as never, log: vi.fn(), check: check as never, onDownloadProgress,
    })
    expect(onDownloadProgress.mock.calls.map((c) => c[0])).toEqual([
      { fakeid: 'f1', total: 2, done: 0, phase: 'start' },
      { fakeid: 'f1', total: 2, done: 1, phase: 'saved' },
      { fakeid: 'f1', total: 2, done: 2, phase: 'done' },
    ])
  })

  it('检查成功即记 lastCheckedAt——不论有无新文章、不论策略(此前只有「仅提示且有新文章」才写,页面显示「尚未检查」与结果自相矛盾)', async () => {
    // 无新文章
    const s1 = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 100 }])
    await runSubscriptionCheck('manual', {
      subs: s1, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(),
      check: (async () => [{ fakeid: 'f1', ok: true, latest: 100, newRefs: [] }]) as never,
    })
    expect((await s1.list())[0].lastCheckedAt).toBeTypeOf('number')
    // 自动下载模式(走 clearNewRefs,此前完全不写 lastCheckedAt)
    const s2 = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 100 }])
    await runSubscriptionCheck('manual', {
      subs: s2, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(),
      check: (async () => [{ fakeid: 'f1', ok: true, latest: 200, newRefs: [{ title: 'a', url: 'ua', createTime: 200 }] }]) as never,
    })
    expect((await s2.list())[0].lastCheckedAt).toBeTypeOf('number')
    // 失败的号没查成,不该记「已检查」
    const s3 = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 100 }])
    await runSubscriptionCheck('manual', {
      subs: s3, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(),
      check: (async () => [{ fakeid: 'f1', ok: false, latest: 100, newRefs: [], error: '频控' }]) as never,
    })
    expect((await s3.list())[0].lastCheckedAt).toBeNull()
  })

  it('notify 模式不发下载进度(没下载就没进度)', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: '甲', watermark: 100 }])
    const check = vi.fn(async () => [{ fakeid: 'f1', ok: true, latest: 200, newRefs: [{ title: 'a', url: 'ua', createTime: 200 }] }])
    const onDownloadProgress = vi.fn()
    await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never,
      downloadRefs: vi.fn(async (refs: { url: string }[]) => okSummary(refs)), log: vi.fn(), check: check as never, onDownloadProgress,
    })
    expect(onDownloadProgress).not.toHaveBeenCalled()
  })
})
