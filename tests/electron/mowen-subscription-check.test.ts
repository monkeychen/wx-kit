// tests/electron/mowen-subscription-check.test.ts
// M63 T2：墨问订阅检查编排。runner/log/subs 全部内存 mock（编排无 electron 运行时）。
// fixture 来自计划「真机锚点」（publicAt unix 秒；null = 缺失发布时间）。
import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMowenSubscriptionCheck, mowenSchedulerCanRun, type MowenCheckDeps } from '../../electron/services/mowen-subscription-check'
import { MowenSubscriptions } from '../../src/core/mowen/subscription'
import { MowenNoteUnavailable } from '../../src/core/mowen/errors'
import type { MowenNoteListItem } from '../../src/core/mowen/types'
import type { CheckLogEntry } from '../../src/core/subscriptions'
import type { MocliRunner } from '../../src/core/mowen/types'

const item = (id: string, publicAt: number | null, title = `t-${id}`): MowenNoteListItem => ({
  noteId: id, uid: 'u1', title, brief: '', url: `https://note.mowen.cn/detail/${id}`,
  publicAt, withFee: false, withImage: false, withText: true, wordCount: null, viewCount: null, favorCount: null,
})

const noopRunner: MocliRunner = async () => { throw new Error('runner 不应被直接调用——listUserNotes 已注入') }

const harness = async (over: Partial<MowenCheckDeps> = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'mowen-check-'))
  const subs = new MowenSubscriptions(root)
  await subs.addAuthor({ uid: 'u1', name: '池建强', intro: '简介', watermark: 1789000000 })
  const logs: CheckLogEntry[] = []
  const downloads: string[] = []
  const deps: MowenCheckDeps = {
    subs,
    runner: noopRunner,
    log: async (e) => { logs.push(e) },
    settings: { subscriptionNewArticleAction: 'notify', defaultFormats: ['md'] },
    downloadNote: async (noteId) => { downloads.push(noteId); return { url: 'u', ok: true, id: `mowen_${noteId}`, dir: '/x' } },
    listUserNotes: async (_run, uid, opts) => {
      expect(uid).toBe('u1'); expect(opts?.count).toBe(20)
      return [item('n1', 1789191409), item('n2', 1789000000), item('n3', null)]
    },
    ...over,
  }
  return { subs, logs, downloads, deps }
}

describe('runMowenSubscriptionCheck', () => {
  it('水位比对：只有 publicAt > watermark 的新笔记入 newNotes（null 不算新）；成功才推水位', async () => {
    const h = await harness()
    const r = await runMowenSubscriptionCheck('manual', h.deps)
    expect(r.authors).toBe(1); expect(r.newFound).toBe(1); expect(r.failed).toBe(0)
    const a = (await h.subs.list())[0]
    expect(a.newNotes.map((n) => n.noteId)).toEqual(['n1'])
    expect(a.watermark).toBe(1789191409)          // 推进到本轮见到的最大 publicAt
    expect(a.lastCheckedAt).not.toBeNull()
    expect(h.logs[0]).toMatchObject({ trigger: 'manual', accounts: 1, newFound: 1, failed: 0, platform: 'mowen' })
  })

  it('自动下载策略 download：新笔记逐篇下载、状态置 downloaded；watermark 照常推进', async () => {
    const h = await harness({ settings: { subscriptionNewArticleAction: 'download', defaultFormats: ['md'] } })
    const r = await runMowenSubscriptionCheck('manual', h.deps)
    expect(r.results[0]).toMatchObject({ ok: true, newFound: 1, downloaded: 1 })
    expect(h.downloads).toEqual(['n1'])
    expect((await h.subs.list())[0].newNotes[0].status).toBe('downloaded')
    // 行内明细同源（对齐微信 M56）：downloadDetail 落条目，articleId=主键可直开阅读器
    expect(h.logs[0].downloadDetail?.[0]).toMatchObject({
      fakeid: 'u1', nickname: '池建强',
      items: [{ title: 't-n1', status: 'downloaded', articleId: 'mowen_n1', url: 'https://note.mowen.cn/detail/n1', refId: 'n1' }],
    })
  })

  it('notify 策略：新笔记落 pending 明细（行内列表两种策略同源）；无下载动作不写 downloaded 计数', async () => {
    const h = await harness({ settings: { subscriptionNewArticleAction: 'notify', defaultFormats: ['md'] } })
    await runMowenSubscriptionCheck('manual', h.deps)
    expect(h.downloads).toEqual([])   // notify 不下载
    const entry = h.logs[0]
    expect(entry.downloadDetail?.[0].items).toEqual([
      { title: 't-n1', status: 'pending', url: 'https://note.mowen.cn/detail/n1', refId: 'n1' },
    ])
    expect(entry.downloaded).toBeUndefined()
    expect(entry.kind).toBeUndefined()
  })

  it('查过无新：落空 items 条目（行内列表据此清空，M58 同规）', async () => {
    const h = await harness()
    await runMowenSubscriptionCheck('manual', h.deps)   // 第一轮发现 n1
    await h.subs.setNoteStatus('u1', ['n1'], 'ignored')
    // 第二轮：水位已推进，n1/n2/n3 都不再是新——但 n1 已 ignored、merged 里 pending=0
    h.logs.length = 0
    const deps: MowenCheckDeps = { ...h.deps, listUserNotes: async () => [item('n1', 1789191409)] }
    await runMowenSubscriptionCheck('manual', deps)
    expect(h.logs[0].downloadDetail?.[0].items).toEqual([])
  })

  it('真故障：落 failed 明细、状态保持 pending，不中断其余篇目', async () => {
    const h = await harness({ settings: { subscriptionNewArticleAction: 'download', defaultFormats: ['md'] } })
    const deps: MowenCheckDeps = {
      ...h.deps,
      listUserNotes: async () => [item('a', 1789191409), item('b', 1789191500)],
      downloadNote: async (noteId: string) => {
        if (noteId === 'a') throw new Error('network down')
        return { url: 'u', ok: true, id: `mowen_${noteId}`, dir: '/x' }
      },
    }
    const r = await runMowenSubscriptionCheck('manual', deps)
    expect(r.results[0]).toMatchObject({ ok: true, newFound: 2, downloaded: 1 })
    const items = h.logs[0].downloadDetail?.[0].items ?? []
    expect(items.find((x) => x.refId === 'a')).toMatchObject({ status: 'failed', error: 'network down' })
    expect(items.find((x) => x.refId === 'b')).toMatchObject({ status: 'downloaded' })
    // failed 保持 pending 可重试
    expect((await h.subs.list())[0].newNotes.find((x) => x.noteId === 'a')?.status).toBe('pending')
  })

  it('重复检查：已见笔记不重复入列；已下载状态不被重置', async () => {
    const h = await harness()
    await runMowenSubscriptionCheck('manual', h.deps)
    await h.subs.setNoteStatus('u1', ['n1'], 'downloaded')
    const r = await runMowenSubscriptionCheck('manual', h.deps)
    expect(r.newFound).toBe(0)
    const a = (await h.subs.list())[0]
    expect(a.newNotes).toHaveLength(1)
    expect(a.newNotes[0].status).toBe('downloaded')
  })

  it('单作者失败：归集该作者名下（ok:false + error），不影响其他作者，失败作者水位不推进', async () => {
    const h = await harness()
    await h.subs.addAuthor({ uid: 'u2', name: '另一个', intro: '', watermark: 1789000000 })
    const deps: MowenCheckDeps = {
      ...h.deps,
      listUserNotes: async (_run, uid: string) => {
        if (uid === 'u1') throw new Error('墨问请求失败: VALIDATE')
        return [item('n9', 1789199999)]
      },
    }
    const r = await runMowenSubscriptionCheck('manual', deps)
    expect(r.failed).toBe(1); expect(r.newFound).toBe(1)
    expect(r.results.find((x) => x.uid === 'u1')).toMatchObject({ ok: false })
    expect(r.results.find((x) => x.uid === 'u1')?.error).toContain('VALIDATE')
    expect((await h.subs.list()).find((x) => x.uid === 'u1')?.watermark).toBe(1789000000)   // 未推进
    expect(h.logs[0].failed).toBe(1)
    expect(h.logs[0].failures?.[0]).toMatchObject({ nickname: '池建强' })
  })

  it('mocli 不可用（runner=null）：如实报 mocli-missing，不得伪装「无新笔记」，水位不动', async () => {
    const h = await harness({ runner: null })
    const r = await runMowenSubscriptionCheck('manual', h.deps)
    expect(r.note).toBe('mocli-missing'); expect(r.failed).toBe(1)
    expect((await h.subs.list())[0].watermark).toBe(1789000000)
    expect(h.logs[0]).toMatchObject({ accounts: 1, failed: 1, platform: 'mowen' })
  })

  it('无订阅：早退 no-authors，日志照写', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mowen-check-'))
    const logs: CheckLogEntry[] = []
    const r = await runMowenSubscriptionCheck('auto', {
      subs: new MowenSubscriptions(root), runner: noopRunner,
      log: async (e) => { logs.push(e) },
      settings: { subscriptionNewArticleAction: 'notify', defaultFormats: ['md'] },
      downloadNote: async () => { throw new Error('x') },
    })
    expect(r.note).toBe('no-authors'); expect(r.authors).toBe(0)
    expect(logs[0]).toMatchObject({ note: 'no-authors', platform: 'mowen' })
  })

  it('付费新笔记下载 unavailable 如实计数，状态保持 pending（重试由用户决定）', async () => {
    const h = await harness({
      settings: { subscriptionNewArticleAction: 'download', defaultFormats: ['md'] },
      downloadNote: async () => { throw new MowenNoteUnavailable() },
    })
    const r = await runMowenSubscriptionCheck('manual', h.deps)
    expect(r.results[0]).toMatchObject({ ok: true, newFound: 1, downloaded: 0, unavailable: 1 })
    expect((await h.subs.list())[0].newNotes[0].status).toBe('pending')
  })

  it('uids 过滤：只检查指定作者（行内单作者检查）', async () => {
    const h = await harness()
    await h.subs.addAuthor({ uid: 'u2', name: '另一个', intro: '', watermark: 1789000000 })
    const calls: string[] = []
    const deps: MowenCheckDeps = {
      ...h.deps,
      uids: ['u2'],
      listUserNotes: async (_run, uid: string) => { calls.push(uid); return [item('n9', 1789199999)] },
    }
    const r = await runMowenSubscriptionCheck('manual', deps)
    expect(r.authors).toBe(1)
    expect(calls).toEqual(['u2'])
    expect(h.logs[0].accounts).toBe(1)
  })
})

describe('mowenSchedulerCanRun（调度闸门）', () => {
  // 背景：mowen 调度器每分钟 tick 都会先过 canRun——原实现直接跑完整 mocli 探测链，
  // 未装 mocli 的机器每次都以「spawn 一个 zsh 登录 shell（最多等 3s）」告终，且发生在
  // 「有没有墨问订阅」判断之前。纯微信用户（零墨问订阅）开着 app 也每分钟白 spawn 一个 shell。
  it('没有已订阅作者 → false 且不做 mocli 探测', async () => {
    let probes = 0
    const probe = async () => { probes++; return true }
    const unsubscribed = { uid: 'u1', name: 'x', intro: '', subscribed: false, watermark: 0, lastCheckedAt: null, lastRunAt: null, newNotes: [] }
    expect(await mowenSchedulerCanRun({ list: async () => [] }, probe)).toBe(false)
    expect(await mowenSchedulerCanRun({ list: async () => [unsubscribed] }, probe)).toBe(false)
    expect(probes).toBe(0)
  })
  it('有已订阅作者 → 探测结论透传（true/false 都如实）', async () => {
    const subscribed = { uid: 'u1', name: 'x', intro: '', subscribed: true, watermark: 0, lastCheckedAt: null, lastRunAt: null, newNotes: [] }
    expect(await mowenSchedulerCanRun({ list: async () => [subscribed] }, async () => true)).toBe(true)
    expect(await mowenSchedulerCanRun({ list: async () => [subscribed] }, async () => false)).toBe(false)
  })
})
