# M11 公众号订阅 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「订阅」页与类 RSS 的公众号订阅——app 运行期按配置的每日时刻检查已订阅公众号的新文章，按配置「仅提示」或「自动下载」。

**Architecture:** core 层放可测纯逻辑与存储：`subscriptions.ts`（`subscriptions.json` 存储 + 派生/合并纯函数）、`subscription-schedule.ts`（`shouldCheckNow` 纯判定）、`check-subscriptions.ts`（注入 `listFn` 的检查编排，只列表不下载、串行+退避、单号失败隔离）。主进程加 `subscription-scheduler.ts`（每分钟 tick → 调 `shouldCheckNow` → 触发检查）与 IPC 编排（复用既有 `mp-fetch`/`mp-auth`/`download-article`/`History`）。renderer 加「订阅」页 + 设置项 + 导航角标，只经 `window.api` 调用。

**Tech Stack:** TypeScript（core 无 electron 依赖）、Electron 主进程、React 18 + antd v6、Vitest、Playwright Electron e2e。

设计依据：`docs/superpowers/specs/2026-06-16-v0.3.0-list-polish-and-subscriptions-design.md`（M11 段）；验收标准 `docs/PRD-v0.3.0.md` §4 R2。

---

## 文件结构

- **Create** `src/core/subscriptions.ts` — `SubscribedAccount` 类型、`Subscriptions` 存储类（`subscriptions.json`）、纯函数 `accountsFromHistory` / `mergeAccounts`。
- **Create** `src/core/subscription-schedule.ts` — 纯判定 `shouldCheckNow`。
- **Create** `src/core/check-subscriptions.ts` — `checkSubscriptions` 检查编排（注入 `listFn`）。
- **Create** `tests/core/subscriptions.test.ts` / `subscription-schedule.test.ts` / `check-subscriptions.test.ts`。
- **Modify** `electron/services/settings.ts` — 增 3 个订阅设置字段 + 默认值。
- **Modify** `tests/electron/settings.test.ts` — 同步整对象断言 + 加一条。
- **Create** `electron/services/subscription-scheduler.ts` — 运行期定时 tick。
- **Modify** `electron/ipc.ts` — 订阅 IPC 处理器 + `runSubscriptionCheck` + 启动 scheduler。
- **Modify** `electron/preload.ts` / `src/renderer/api.ts` — 暴露订阅 API。
- **Create** `src/renderer/pages/Subscriptions.tsx` — 订阅管理页。
- **Modify** `src/renderer/App.tsx` / `src/renderer/layouts/MainLayout.tsx` — 路由 + 导航项 + 角标。
- **Modify** `src/renderer/pages/Settings.tsx` — 3 个订阅设置控件。
- **Modify** `tests/e2e/gui.e2e.mjs` — 订阅页渲染/添加/切换/检查断言。

---

## Task 1: core — Subscriptions 存储 + 派生/合并纯函数

**Files:**
- Create: `src/core/subscriptions.ts`
- Test: `tests/core/subscriptions.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/core/subscriptions.test.ts`：
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Subscriptions, accountsFromHistory, mergeAccounts } from '../../src/core/subscriptions'
import type { HistoryEvent } from '../../src/core/download-history'

describe('Subscriptions store', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wxk-subs-')) })

  it('empty when no file', async () => {
    const s = new Subscriptions(dir)
    expect(await s.list()).toEqual([])
    expect(await s.getLastRunAt()).toBeNull()
  })

  it('addAccount adds, and re-add updates identity but keeps newRefs', async () => {
    const s = new Subscriptions(dir)
    await s.addAccount({ fakeid: 'f1', nickname: '甲', subscribed: true, watermark: 100 })
    await s.setNewRefs('f1', [{ url: 'u', title: 't', createTime: 200 }])
    await s.addAccount({ fakeid: 'f1', nickname: '甲改名', subscribed: true, watermark: 150 })
    const [a] = await s.list()
    expect(a).toMatchObject({ fakeid: 'f1', nickname: '甲改名', subscribed: true, watermark: 150 })
    expect(a.newRefs).toHaveLength(1)   // 重加不抹掉已发现的新文章
  })

  it('setSubscribed / updateWatermark / setNewRefs / clearNewRefs', async () => {
    const s = new Subscriptions(dir)
    await s.addAccount({ fakeid: 'f1', nickname: '甲', subscribed: false, watermark: 0 })
    await s.setSubscribed('f1', true)
    await s.updateWatermark('f1', 300)
    await s.setNewRefs('f1', [{ url: 'u', title: 't', createTime: 400 }])
    let [a] = await s.list()
    expect(a).toMatchObject({ subscribed: true, watermark: 300 })
    expect(a.newRefs).toHaveLength(1)
    await s.clearNewRefs('f1')
    ;[a] = await s.list()
    expect(a.newRefs).toEqual([])
  })

  it('persists lastRunAt across instances', async () => {
    const s = new Subscriptions(dir)
    await s.setLastRunAt(1234)
    expect(await new Subscriptions(dir).getLastRunAt()).toBe(1234)
  })
})

describe('accountsFromHistory', () => {
  it('extracts distinct account-kind {fakeid,nickname}, latest nickname wins', () => {
    const evs = [
      { source: { kind: 'account', fakeid: 'f1', nickname: '甲', range: { count: 1 } } },
      { source: { kind: 'url', count: 2 } },
      { source: { kind: 'account', fakeid: 'f1', nickname: '甲新', range: { count: 1 } } },
      { source: { kind: 'account', fakeid: 'f2', nickname: '乙', range: { count: 1 } } },
    ] as unknown as HistoryEvent[]
    expect(accountsFromHistory(evs)).toEqual([{ fakeid: 'f1', nickname: '甲新' }, { fakeid: 'f2', nickname: '乙' }])
  })
})

describe('mergeAccounts', () => {
  it('stored wins; history-only appear unsubscribed with empty state', () => {
    const stored = [{ fakeid: 'f1', nickname: '甲', subscribed: true, watermark: 100, lastCheckedAt: 9, newRefs: [] }]
    const merged = mergeAccounts([{ fakeid: 'f1', nickname: 'X' }, { fakeid: 'f2', nickname: '乙' }], stored)
    expect(merged.find((a) => a.fakeid === 'f1')).toMatchObject({ nickname: '甲', subscribed: true, watermark: 100 })
    expect(merged.find((a) => a.fakeid === 'f2')).toMatchObject({ nickname: '乙', subscribed: false, watermark: 0, lastCheckedAt: null, newRefs: [] })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/subscriptions.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`src/core/subscriptions.ts`：
```ts
// src/core/subscriptions.ts
// 公众号订阅存储（库根下 subscriptions.json）+ 派生/合并纯函数。仿 download-history 的文件读写。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArticleRef } from './mp-types'
import type { HistoryEvent } from './download-history'

export interface SubscribedAccount {
  fakeid: string
  nickname: string
  subscribed: boolean
  watermark: number            // unix 秒；createTime > watermark 即「新」
  lastCheckedAt: number | null // unix ms
  newRefs: ArticleRef[]        // 已发现、待下载/忽略的新文章
}

interface SubscriptionsFile { version: 1; lastRunAt: number | null; accounts: SubscribedAccount[] }

/** 从下载历史抽出去重的「按公众号抓取」账号（fakeid → nickname，后出现的昵称覆盖）。纯函数。 */
export function accountsFromHistory(events: HistoryEvent[]): { fakeid: string; nickname: string }[] {
  const seen = new Map<string, string>()
  for (const ev of events) {
    if (ev.source.kind === 'account') seen.set(ev.source.fakeid, ev.source.nickname)
  }
  return [...seen.entries()].map(([fakeid, nickname]) => ({ fakeid, nickname }))
}

/** 合并「历史派生账号」与「已存订阅」：已存的保留其状态；仅在历史里的补成未订阅空态。纯函数。 */
export function mergeAccounts(
  fromHistory: { fakeid: string; nickname: string }[], stored: SubscribedAccount[],
): SubscribedAccount[] {
  const byId = new Map<string, SubscribedAccount>()
  for (const a of stored) byId.set(a.fakeid, a)
  for (const h of fromHistory) {
    if (!byId.has(h.fakeid)) {
      byId.set(h.fakeid, { fakeid: h.fakeid, nickname: h.nickname, subscribed: false, watermark: 0, lastCheckedAt: null, newRefs: [] })
    }
  }
  return [...byId.values()]
}

export class Subscriptions {
  private path: string
  constructor(private root: string) { this.path = join(root, 'subscriptions.json') }

  private async read(): Promise<SubscriptionsFile> {
    try {
      return JSON.parse(await readFile(this.path, 'utf-8')) as SubscriptionsFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, lastRunAt: null, accounts: [] }
      throw new Error(`subscriptions file is corrupt at ${this.path} — delete it to reset`)
    }
  }
  private async write(data: SubscriptionsFile): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeFile(this.path, JSON.stringify(data, null, 2), 'utf-8')
  }
  private async mutate(fn: (d: SubscriptionsFile) => void): Promise<void> {
    const d = await this.read(); fn(d); await this.write(d)
  }
  private find(d: SubscriptionsFile, fakeid: string): SubscribedAccount | undefined {
    return d.accounts.find((a) => a.fakeid === fakeid)
  }

  async list(): Promise<SubscribedAccount[]> { return (await this.read()).accounts }
  async getLastRunAt(): Promise<number | null> { return (await this.read()).lastRunAt }
  async setLastRunAt(t: number): Promise<void> { await this.mutate((d) => { d.lastRunAt = t }) }

  /** 新增或更新账号身份/订阅态/水位；已存则保留 newRefs 与 lastCheckedAt。 */
  async addAccount(acc: { fakeid: string; nickname: string; subscribed: boolean; watermark: number }): Promise<void> {
    await this.mutate((d) => {
      const ex = this.find(d, acc.fakeid)
      if (ex) { ex.nickname = acc.nickname; ex.subscribed = acc.subscribed; ex.watermark = acc.watermark }
      else d.accounts.push({ ...acc, lastCheckedAt: null, newRefs: [] })
    })
  }
  async setSubscribed(fakeid: string, subscribed: boolean): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) a.subscribed = subscribed })
  }
  async updateWatermark(fakeid: string, watermark: number): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) a.watermark = watermark })
  }
  async setNewRefs(fakeid: string, refs: ArticleRef[]): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) { a.newRefs = refs; a.lastCheckedAt = Date.now() } })
  }
  async clearNewRefs(fakeid: string): Promise<void> {
    await this.mutate((d) => { const a = this.find(d, fakeid); if (a) a.newRefs = [] })
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/subscriptions.test.ts`
Expected: PASS（6 条）。

- [ ] **Step 5: 提交**

```bash
git add src/core/subscriptions.ts tests/core/subscriptions.test.ts
git commit -m "feat(core): subscriptions store (subscriptions.json) + history-derive/merge pure fns"
```

---

## Task 2: core — 调度判定 shouldCheckNow

**Files:**
- Create: `src/core/subscription-schedule.ts`
- Test: `tests/core/subscription-schedule.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/core/subscription-schedule.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { shouldCheckNow } from '../../src/core/subscription-schedule'

// 用本地时间构造「某天 09:00」的工具
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe('shouldCheckNow', () => {
  const base = { checkTime: '09:00' }
  it('false when autoCheck off', () => {
    expect(shouldCheckNow({ ...base, now: at(2026, 6, 16, 10, 0), lastCheckedAt: null, autoCheck: false })).toBe(false)
  })
  it('false before the scheduled time', () => {
    expect(shouldCheckNow({ ...base, now: at(2026, 6, 16, 8, 59), lastCheckedAt: null, autoCheck: true })).toBe(false)
  })
  it('true after scheduled time, never checked', () => {
    expect(shouldCheckNow({ ...base, now: at(2026, 6, 16, 9, 1), lastCheckedAt: null, autoCheck: true })).toBe(true)
  })
  it('false when already checked today (after scheduled)', () => {
    expect(shouldCheckNow({ ...base, now: at(2026, 6, 16, 12, 0), lastCheckedAt: at(2026, 6, 16, 9, 1), autoCheck: true })).toBe(false)
  })
  it('true (launch catch-up) when last check was before today’s slot', () => {
    expect(shouldCheckNow({ ...base, now: at(2026, 6, 16, 10, 0), lastCheckedAt: at(2026, 6, 15, 9, 1), autoCheck: true })).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/subscription-schedule.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`src/core/subscription-schedule.ts`：
```ts
// src/core/subscription-schedule.ts
// 运行期定时检查的纯判定：app 必须开着才检查；启动时若当天时刻已过且未检查则补检一次。
export interface ScheduleInput {
  now: number                  // unix ms
  checkTime: string            // "HH:MM"（本地时间）
  lastCheckedAt: number | null // 上次检查运行的 unix ms
  autoCheck: boolean
}

/** 当天 checkTime 对应的本地时间戳。 */
function scheduledTsFor(now: number, checkTime: string): number {
  const d = new Date(now)
  const [h, m] = checkTime.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/** 现在是否该触发一次检查。 */
export function shouldCheckNow(i: ScheduleInput): boolean {
  if (!i.autoCheck) return false
  const scheduled = scheduledTsFor(i.now, i.checkTime)
  if (i.now < scheduled) return false
  if (i.lastCheckedAt != null && i.lastCheckedAt >= scheduled) return false
  return true
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/subscription-schedule.test.ts`
Expected: PASS（5 条）。

- [ ] **Step 5: 提交**

```bash
git add src/core/subscription-schedule.ts tests/core/subscription-schedule.test.ts
git commit -m "feat(core): shouldCheckNow schedule decision (runtime + launch catch-up)"
```

---

## Task 3: core — 检查编排 checkSubscriptions

**Files:**
- Create: `src/core/check-subscriptions.ts`
- Test: `tests/core/check-subscriptions.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/core/check-subscriptions.test.ts`：
```ts
import { describe, it, expect, vi } from 'vitest'
import { checkSubscriptions } from '../../src/core/check-subscriptions'
import { MpRateLimited, MpAuthExpired } from '../../src/core/mp-errors'
import type { SubscribedAccount } from '../../src/core/subscriptions'
import type { ArticleRef } from '../../src/core/mp-types'

const acc = (fakeid: string, watermark: number): SubscribedAccount =>
  ({ fakeid, nickname: fakeid, subscribed: true, watermark, lastCheckedAt: null, newRefs: [] })
const ref = (createTime: number): ArticleRef => ({ url: 'u' + createTime, title: 't' + createTime, createTime })
const fastSleep = async () => {}
const fetchStub = (async () => ({})) as never

describe('checkSubscriptions', () => {
  it('returns only refs newer than watermark, newest first, and advances latest', async () => {
    const listFn = vi.fn(async () => [ref(90), ref(120), ref(110)])
    const [r] = await checkSubscriptions([acc('f1', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep })
    expect(r.ok).toBe(true)
    expect(r.newRefs.map((x) => x.createTime)).toEqual([120, 110])
    expect(r.latest).toBe(120)
  })

  it('no new articles → empty newRefs, latest stays at observed max', async () => {
    const listFn = vi.fn(async () => [ref(50), ref(80)])
    const [r] = await checkSubscriptions([acc('f1', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep })
    expect(r.newRefs).toEqual([])
    expect(r.latest).toBe(100)
  })

  it('retries on rate-limit then succeeds (onBackoff fired)', async () => {
    const listFn = vi.fn()
      .mockRejectedValueOnce(new MpRateLimited('rl'))
      .mockResolvedValueOnce([ref(200)])
    const onBackoff = vi.fn()
    const [r] = await checkSubscriptions([acc('f1', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep, onBackoff })
    expect(r.ok).toBe(true)
    expect(r.newRefs.map((x) => x.createTime)).toEqual([200])
    expect(onBackoff).toHaveBeenCalledOnce()
  })

  it('per-account isolation: one generic failure does not stop the rest', async () => {
    const listFn = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([ref(200)])
    const res = await checkSubscriptions([acc('f1', 100), acc('f2', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep })
    expect(res[0]).toMatchObject({ fakeid: 'f1', ok: false })
    expect(res[1]).toMatchObject({ fakeid: 'f2', ok: true })
  })

  it('auth-expired aborts the whole check', async () => {
    const listFn = vi.fn(async () => { throw new MpAuthExpired('expired') })
    await expect(checkSubscriptions([acc('f1', 100)], { mpFetch: fetchStub, token: 't', listFn, sleep: fastSleep }))
      .rejects.toBeInstanceOf(MpAuthExpired)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/check-subscriptions.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`src/core/check-subscriptions.ts`：
```ts
// src/core/check-subscriptions.ts
// 订阅检查编排：逐号「只列表不下载」，串行 + 账号间延迟 + 频控退避；单号失败隔离，登录失效整体中止。
import { listArticles as listImpl, sleep as sleepImpl } from './mp-client'
import { MpRateLimited, MpAuthExpired } from './mp-errors'
import type { ArticleRef, MpFetch, CrawlRange } from './mp-types'
import type { SubscribedAccount } from './subscriptions'

const RECENT: CrawlRange = { count: 20 }   // 每号取最近 20 篇与水位比对；日检测频率下足够

export interface CheckDeps {
  mpFetch: MpFetch
  token: string
  listFn?: typeof listImpl
  sleep?: (ms: number) => Promise<void>
  onBackoff?: (ev: { fakeid: string; attempt: number; waitMs: number }) => void
}
export interface AccountCheckResult { fakeid: string; ok: boolean; newRefs: ArticleRef[]; latest: number; error?: string }

export async function checkSubscriptions(accounts: SubscribedAccount[], deps: CheckDeps): Promise<AccountCheckResult[]> {
  const sleep = deps.sleep ?? sleepImpl
  const listFn = deps.listFn ?? listImpl
  const results: AccountCheckResult[] = []
  let first = true
  for (const acc of accounts) {
    if (!first) await sleep(2000)   // 账号间间隔，缓解频控
    first = false
    let refs: ArticleRef[] | null = null
    for (let attempt = 0; ; attempt++) {
      try { refs = await listFn(deps.mpFetch, deps.token, acc.fakeid, RECENT, { sleep }); break }
      catch (e) {
        if (e instanceof MpAuthExpired) throw e   // 登录态失效：整体中止，交上层引导重新登录
        if (e instanceof MpRateLimited && attempt < 3) {
          const waitMs = 30000 * (attempt + 1)
          deps.onBackoff?.({ fakeid: acc.fakeid, attempt: attempt + 1, waitMs })
          await sleep(waitMs); continue
        }
        results.push({ fakeid: acc.fakeid, ok: false, newRefs: [], latest: acc.watermark, error: (e as Error).message })
        refs = null; break
      }
    }
    if (refs == null) continue
    const newRefs = refs.filter((r) => r.createTime > acc.watermark).sort((a, b) => b.createTime - a.createTime)
    const latest = refs.reduce((mx, r) => Math.max(mx, r.createTime), acc.watermark)
    results.push({ fakeid: acc.fakeid, ok: true, newRefs, latest })
  }
  return results
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/check-subscriptions.test.ts`
Expected: PASS（5 条）。

- [ ] **Step 5: 提交**

```bash
git add src/core/check-subscriptions.ts tests/core/check-subscriptions.test.ts
git commit -m "feat(core): checkSubscriptions orchestration (list-only, backoff, isolation, auth-abort)"
```

---

## Task 4: settings — 3 个订阅设置字段

**Files:**
- Modify: `electron/services/settings.ts`
- Test: `tests/electron/settings.test.ts`

- [ ] **Step 1: 先改测试（会失败）**

在 `tests/electron/settings.test.ts` 中，给 3 处整对象 `toEqual` 各追加三个字段，并加一条订阅设置默认值断言。

第 1 处（returns defaults）的整对象末尾追加：
```ts
      subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify',
```
即该断言对象变为（含 M10 已加的 listColumnWidths）：
```ts
    expect(v).toEqual({ libraryRoot: '/default/lib', defaultFormats: ['md', 'html', 'meta'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify' })
```

第 2 处（persists and reloads）：
```ts
    expect(await s2.get()).toEqual({ libraryRoot: '/custom', defaultFormats: ['md', 'pdf'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify' })
```

第 3 处（merges partial save）：
```ts
    expect(await s.get()).toEqual({ libraryRoot: '/custom', defaultFormats: ['html'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify' })
```

在 describe 末尾新增：
```ts
  it('persists subscription settings', async () => {
    const s = new SettingsService(dir, '/default/lib')
    await s.save({ subscriptionAutoCheck: true, subscriptionCheckTime: '07:30', subscriptionNewArticleAction: 'download' })
    const s2 = new SettingsService(dir, '/default/lib')
    const v = await s2.get()
    expect(v.subscriptionAutoCheck).toBe(true)
    expect(v.subscriptionCheckTime).toBe('07:30')
    expect(v.subscriptionNewArticleAction).toBe('download')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/electron/settings.test.ts`
Expected: FAIL —— 默认值不含订阅字段 / 类型缺失。

- [ ] **Step 3: 实现**

`electron/services/settings.ts` 的 `AppSettings` 增字段：
```ts
export type NewArticleAction = 'notify' | 'download'

export interface AppSettings {
  libraryRoot: string
  defaultFormats: DownloadFormat[]
  historyRetentionDays: number
  listColumnWidths: ListColumnWidths
  subscriptionAutoCheck: boolean
  subscriptionCheckTime: string          // "HH:MM"
  subscriptionNewArticleAction: NewArticleAction
}
```

`defaults()` 增默认值（在 listColumnWidths 之后）：
```ts
      listColumnWidths: { account: 132, publish: 150, download: 110 },
      subscriptionAutoCheck: false,
      subscriptionCheckTime: '09:00',
      subscriptionNewArticleAction: 'notify',
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/electron/settings.test.ts`
Expected: PASS（5 条）。

- [ ] **Step 5: 提交**

```bash
git add electron/services/settings.ts tests/electron/settings.test.ts
git commit -m "feat(settings): add subscription auto-check / check-time / new-article-action"
```

---

## Task 5: 主进程 — 调度服务 + IPC 编排 + 桥接

**Files:**
- Create: `electron/services/subscription-scheduler.ts`
- Modify: `electron/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/renderer/api.ts`

- [ ] **Step 1: 调度服务**

`electron/services/subscription-scheduler.ts`：
```ts
// electron/services/subscription-scheduler.ts
// 运行期每分钟 tick：到达配置时刻且当天未检查则触发；start() 时立即 tick 一次做启动补检。GUI 模式专用。
import { shouldCheckNow } from '../../src/core/subscription-schedule'
import type { Subscriptions } from '../../src/core/subscriptions'
import type { SettingsService } from './settings'

export interface SchedulerDeps {
  settings: SettingsService
  subsFor: () => Promise<Subscriptions>
  runCheck: () => Promise<void>
  now?: () => number
}

export class SubscriptionScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  constructor(private deps: SchedulerDeps) {}

  start(): void {
    void this.tick()
    this.timer = setInterval(() => { void this.tick() }, 60_000)
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null } }

  private async tick(): Promise<void> {
    try {
      const s = await this.deps.settings.get()
      if (!s.subscriptionAutoCheck) return
      const now = (this.deps.now ?? Date.now)()
      const lastRunAt = await (await this.deps.subsFor()).getLastRunAt()
      if (shouldCheckNow({ now, checkTime: s.subscriptionCheckTime, lastCheckedAt: lastRunAt, autoCheck: true })) {
        await this.deps.runCheck()
      }
    } catch { /* 定时检查失败不应影响应用其余部分；下次 tick 再来 */ }
  }
}
```

- [ ] **Step 2: IPC 编排 + 启动调度**

在 `electron/ipc.ts` 顶部 import 区追加：
```ts
import { listArticles } from '../src/core/mp-client'
import { Subscriptions, accountsFromHistory, mergeAccounts } from '../src/core/subscriptions'
import { checkSubscriptions } from '../src/core/check-subscriptions'
import { SubscriptionScheduler } from './services/subscription-scheduler'
import type { ArticleRef } from '../src/core/mp-types'
```

在 `registerIpc` 内、`mp:crawl` 处理器之后（第 130 行 `}` 之前，即所有现有 handler 注册之后）插入订阅相关：
```ts
  // —— M11 公众号订阅 ——
  const subsFor = async () => new Subscriptions((await settings.get()).libraryRoot)
  const emitSubsUpdated = () => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('subscriptions:updated')
  }
  let subsAuthExpired = false

  // 订阅/新订阅一刻确定水位：能取到最新一篇就用其 createTime，否则用「现在」（秒），避免存量被当新文章
  const establishWatermark = async (fakeid: string): Promise<number> => {
    const session = getSession()
    if (!session) return Math.floor(Date.now() / 1000)
    try {
      const refs = await listArticles(makeMpFetch(session), session.token, fakeid, { count: 1 })
      return refs[0]?.createTime ?? Math.floor(Date.now() / 1000)
    } catch { return Math.floor(Date.now() / 1000) }
  }

  const downloadRefs = async (refs: ArticleRef[], formats: DownloadFormat[], source: HistorySource) => {
    const { libraryRoot } = await settings.get()
    const library = new Library(libraryRoot)
    const ddeps = { fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot }
    const queue = new DownloadQueue((url) => downloadArticle(url, formats, ddeps))
    const summary = await queue.run(refs.map((r) => r.url))
    await recordHistory(source, formats, summary)
  }

  const runSubscriptionCheck = async () => {
    const session = getSession()
    if (!session) { subsAuthExpired = true; emitSubsUpdated(); return }
    const subs = await subsFor()
    const accounts = (await subs.list()).filter((a) => a.subscribed)
    if (!accounts.length) { await subs.setLastRunAt(Date.now()); return }
    const s = await settings.get()
    let results
    try {
      results = await checkSubscriptions(accounts, { mpFetch: makeMpFetch(session), token: session.token })
    } catch (e) {
      if (e instanceof MpAuthExpired) { subsAuthExpired = true; emitSubsUpdated(); return }
      throw e
    }
    subsAuthExpired = false
    for (const r of results) {
      if (!r.ok) continue
      await subs.updateWatermark(r.fakeid, r.latest)
      if (r.newRefs.length === 0) continue
      if (s.subscriptionNewArticleAction === 'download') {
        const acc = accounts.find((a) => a.fakeid === r.fakeid)!
        await downloadRefs(r.newRefs, s.defaultFormats, { kind: 'account', nickname: acc.nickname, fakeid: r.fakeid, range: { count: r.newRefs.length } })
        await subs.clearNewRefs(r.fakeid)
      } else {
        await subs.setNewRefs(r.fakeid, r.newRefs)
      }
    }
    await subs.setLastRunAt(Date.now())
    emitSubsUpdated()
  }

  ipcMain.handle('subscriptions:list', async () => {
    const { events } = await (await historyFor()).list(0, 1_000_000)
    const merged = mergeAccounts(accountsFromHistory(events), await (await subsFor()).list())
    return { accounts: merged, authExpired: subsAuthExpired, lastRunAt: await (await subsFor()).getLastRunAt() }
  })
  ipcMain.handle('subscriptions:addAccount', async (_e, { fakeid, nickname }: { fakeid: string; nickname: string }) => {
    await (await subsFor()).addAccount({ fakeid, nickname, subscribed: true, watermark: await establishWatermark(fakeid) })
    emitSubsUpdated()
  })
  ipcMain.handle('subscriptions:setSubscribed', async (_e, { fakeid, nickname, subscribed }: { fakeid: string; nickname: string; subscribed: boolean }) => {
    const subs = await subsFor()
    const ex = (await subs.list()).find((a) => a.fakeid === fakeid)
    if (!ex) {
      await subs.addAccount({ fakeid, nickname, subscribed, watermark: subscribed ? await establishWatermark(fakeid) : 0 })
    } else {
      if (subscribed && ex.watermark === 0) await subs.updateWatermark(fakeid, await establishWatermark(fakeid))
      await subs.setSubscribed(fakeid, subscribed)
    }
    emitSubsUpdated()
  })
  ipcMain.handle('subscriptions:checkNow', async () => { await runSubscriptionCheck() })
  ipcMain.handle('subscriptions:downloadNew', async (_e, fakeid: string) => {
    const subs = await subsFor()
    const acc = (await subs.list()).find((a) => a.fakeid === fakeid)
    if (!acc || !acc.newRefs.length) return
    await downloadRefs(acc.newRefs, (await settings.get()).defaultFormats, { kind: 'account', nickname: acc.nickname, fakeid, range: { count: acc.newRefs.length } })
    await subs.clearNewRefs(fakeid)
    emitSubsUpdated()
  })
  ipcMain.handle('subscriptions:dismissNew', async (_e, fakeid: string) => {
    const subs = await subsFor()
    const acc = (await subs.list()).find((a) => a.fakeid === fakeid)
    if (acc) await subs.updateWatermark(fakeid, acc.newRefs.reduce((mx, r) => Math.max(mx, r.createTime), acc.watermark))
    await subs.clearNewRefs(fakeid)
    emitSubsUpdated()
  })

  new SubscriptionScheduler({ settings, subsFor, runCheck: runSubscriptionCheck }).start()
```

- [ ] **Step 3: preload 暴露 API**

`electron/preload.ts` 的 `api` 对象内（`mpCancelCrawl` 之后）追加：
```ts
  subscriptionsList: () => ipcRenderer.invoke('subscriptions:list'),
  subscriptionsAddAccount: (fakeid, nickname) => ipcRenderer.invoke('subscriptions:addAccount', { fakeid, nickname }),
  subscriptionsSetSubscribed: (fakeid, nickname, subscribed) => ipcRenderer.invoke('subscriptions:setSubscribed', { fakeid, nickname, subscribed }),
  subscriptionsCheckNow: () => ipcRenderer.invoke('subscriptions:checkNow'),
  subscriptionsDownloadNew: (fakeid) => ipcRenderer.invoke('subscriptions:downloadNew', fakeid),
  subscriptionsDismissNew: (fakeid) => ipcRenderer.invoke('subscriptions:dismissNew', fakeid),
  onSubscriptionsUpdated: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('subscriptions:updated', listener)
    return () => { ipcRenderer.removeListener('subscriptions:updated', listener) }
  },
```

- [ ] **Step 4: api.ts 类型**

`src/renderer/api.ts` 顶部 import 区追加：
```ts
import type { SubscribedAccount } from '../core/subscriptions'
export type { SubscribedAccount } from '../core/subscriptions'

export interface SubscriptionsState { accounts: SubscribedAccount[]; authExpired: boolean; lastRunAt: number | null }
```

在 `WxApi` 接口内（`historyClear` 之后）追加：
```ts
  // —— M11 公众号订阅 ——
  subscriptionsList(): Promise<SubscriptionsState>
  subscriptionsAddAccount(fakeid: string, nickname: string): Promise<void>
  subscriptionsSetSubscribed(fakeid: string, nickname: string, subscribed: boolean): Promise<void>
  subscriptionsCheckNow(): Promise<void>
  subscriptionsDownloadNew(fakeid: string): Promise<void>
  subscriptionsDismissNew(fakeid: string): Promise<void>
  onSubscriptionsUpdated(cb: () => void): () => void
```

- [ ] **Step 5: 验证类型 + lint + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: 全通过。若 `SubscribedAccount` 等类型未对齐报错，按定义修正后重跑。

- [ ] **Step 6: 提交**

```bash
git add electron/services/subscription-scheduler.ts electron/ipc.ts electron/preload.ts src/renderer/api.ts
git commit -m "feat(main): subscription IPC + scheduler + runSubscriptionCheck wiring"
```

---

## Task 6: renderer — 订阅页 + 路由 + 导航角标

**Files:**
- Create: `src/renderer/pages/Subscriptions.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/layouts/MainLayout.tsx`

- [ ] **Step 1: 订阅页**

`src/renderer/pages/Subscriptions.tsx`：
```tsx
import { useEffect, useState } from 'react'
import { Input, Switch, Button, Spin, Alert, message, List, Tag } from 'antd'
import { api } from '../api'
import type { SubscribedAccount } from '../api'
import type { MpAccount } from '../../core/mp-types'

export default function Subscriptions() {
  const [accounts, setAccounts] = useState<SubscribedAccount[]>([])
  const [authExpired, setAuthExpired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [kw, setKw] = useState('')
  const [candidates, setCandidates] = useState<MpAccount[]>([])

  const load = async () => {
    setLoading(true)
    try { const s = await api.subscriptionsList(); setAccounts(s.accounts); setAuthExpired(s.authExpired) }
    finally { setLoading(false) }
  }
  useEffect(() => { load(); return api.onSubscriptionsUpdated(load) }, [])

  const toggle = async (a: SubscribedAccount, next: boolean) => {
    await api.subscriptionsSetSubscribed(a.fakeid, a.nickname, next); await load()
  }
  const search = async () => {
    const name = kw.trim(); if (!name) return
    const r = await api.mpSearch(name)
    if (!r.ok) { message.error(r.error?.message ?? '搜索失败'); setAuthExpired(r.error?.code === 'AUTH_REQUIRED'); return }
    setCandidates(r.list ?? [])
  }
  const add = async (c: MpAccount) => {
    await api.subscriptionsAddAccount(c.fakeid, c.nickname); setCandidates([]); setKw(''); await load(); message.success(`已订阅「${c.nickname}」`)
  }
  const checkNow = async () => {
    setChecking(true)
    try { await api.subscriptionsCheckNow(); await load() }
    finally { setChecking(false) }
  }

  return (
    <div className="page">
      <div className="fade-in">
        <div className="page-head">
          <div className="eyebrow">Subscriptions</div>
          <h1 className="page-title">订阅</h1>
        </div>

        {authExpired && <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message="订阅检查需重新登录公众号后台" description="到「下载 · 按公众号」扫码登录后，订阅检查会自动恢复。" />}

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Input placeholder="搜索公众号名称以添加订阅" value={kw} onChange={(e) => setKw(e.target.value)}
            onPressEnter={search} style={{ width: 280 }} data-testid="subs-search-input" allowClear />
          <Button onClick={search} data-testid="subs-search-btn">搜索</Button>
          <div style={{ flex: 1 }} />
          <Button type="primary" loading={checking} onClick={checkNow} data-testid="subs-check-now">检查更新</Button>
        </div>

        {candidates.length > 0 && (
          <List size="small" bordered style={{ marginBottom: 16 }} dataSource={candidates}
            renderItem={(c) => (
              <List.Item actions={[<a key="add" onClick={() => add(c)}>订阅</a>]}>
                <span>{c.nickname}</span>{c.alias && <span className="faint" style={{ marginLeft: 8 }}>{c.alias}</span>}
              </List.Item>
            )} />
        )}

        {loading ? <div style={{ padding: 80, textAlign: 'center' }}><Spin /></div>
          : accounts.length === 0 ? (
            <div className="empty-state">
              <div className="es-mark">订</div>
              <div className="es-title">还没有可订阅的公众号</div>
              <div>下载过某公众号的文章后它会出现在这里，或上方搜索名称直接添加。</div>
            </div>
          ) : (
            <List dataSource={accounts} data-testid="subs-list" renderItem={(a) => (
              <List.Item data-testid="subs-row" actions={[
                a.newRefs.length > 0 ? <a key="dl" data-testid="subs-download-new" onClick={async () => { await api.subscriptionsDownloadNew(a.fakeid); await load() }}>下载 {a.newRefs.length} 篇新文章</a> : <span key="none" className="faint">无新文章</span>,
                a.newRefs.length > 0 ? <a key="ig" onClick={async () => { await api.subscriptionsDismissNew(a.fakeid); await load() }}>忽略</a> : null,
              ]}>
                <List.Item.Meta
                  title={<span>{a.nickname} {a.newRefs.length > 0 && <Tag color="red">{a.newRefs.length} 新</Tag>}</span>}
                  description={a.lastCheckedAt ? `上次检查 ${new Date(a.lastCheckedAt).toLocaleString()}` : '尚未检查'} />
                <Switch checked={a.subscribed} onChange={(v) => toggle(a, v)} data-testid="subs-toggle"
                  checkedChildren="已订阅" unCheckedChildren="未订阅" />
              </List.Item>
            )} />
          )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 路由**

`src/renderer/App.tsx`：import 与 Route 各加一行。

import 区（`import Settings ...` 之后）：
```tsx
import Subscriptions from './pages/Subscriptions'
```
Route（`library` 那条之后）：
```tsx
        <Route path="subscriptions" element={<Subscriptions />} />
```

- [ ] **Step 3: 导航项 + 角标**

`src/renderer/layouts/MainLayout.tsx` 改为带订阅项与新文章角标：
```tsx
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../api'

const NAV = [
  { to: '/', label: '下载', end: true },
  { to: '/subscriptions', label: '订阅', end: false },
  { to: '/library', label: '文库', end: false },
  { to: '/settings', label: '设置', end: false },
]

export default function MainLayout() {
  const [newCount, setNewCount] = useState(0)
  useEffect(() => {
    const refresh = async () => {
      try { const s = await api.subscriptionsList(); setNewCount(s.accounts.reduce((n, a) => n + a.newRefs.length, 0)) }
      catch { /* 忽略：导航角标不应阻塞渲染 */ }
    }
    refresh()
    return api.onSubscriptionsUpdated(refresh)
  }, [])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }} data-testid="app-shell">
      <header className="masthead">
        <div className="brand">
          <span className="brand-title">微信百宝箱</span>
          <span className="brand-mark">wx-kit</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              data-testid={`nav-${n.label}`}>
              {n.label}
              {n.to === '/subscriptions' && newCount > 0 && <span className="nav-badge" data-testid="subs-nav-badge">{newCount}</span>}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  )
}
```

`src/renderer/index.css` 在导航相关样式附近追加角标样式（放在文件末尾即可）：
```css
.nav-badge { display: inline-block; min-width: 16px; height: 16px; padding: 0 5px; margin-left: 6px; border-radius: 8px; background: var(--cinnabar); color: #fff; font-size: 11px; line-height: 16px; text-align: center; vertical-align: middle; }
```

- [ ] **Step 4: 验证类型 + lint + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: 全通过。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/pages/Subscriptions.tsx src/renderer/App.tsx src/renderer/layouts/MainLayout.tsx src/renderer/index.css
git commit -m "feat(renderer): subscriptions page + route + nav item with new-article badge"
```

---

## Task 7: renderer — 设置页 3 个订阅控件

**Files:**
- Modify: `src/renderer/pages/Settings.tsx`

- [ ] **Step 1: 读现状**

先读 `src/renderer/pages/Settings.tsx`，确认它如何读写 settings（`api.getSettings` / `api.saveSettings`）与现有控件排版，照其既有模式加一段「订阅」设置区。

- [ ] **Step 2: 加订阅设置区**

在 Settings 页的设置项区域追加一段（沿用该页既有的 state + `saveSettings` 写回模式；下面给出控件与处理，字段名须与 `AppSettings` 一致）：
```tsx
{/* 订阅 */}
<section className="settings-section">
  <h2>订阅</h2>
  <div className="settings-row">
    <span>自动检查更新</span>
    <Switch checked={settings.subscriptionAutoCheck}
      data-testid="set-subs-auto"
      onChange={(v) => persist({ subscriptionAutoCheck: v })} />
  </div>
  <div className="settings-row">
    <span>每日检查时刻</span>
    <Input type="time" value={settings.subscriptionCheckTime} style={{ width: 120 }}
      data-testid="set-subs-time"
      onChange={(e) => persist({ subscriptionCheckTime: e.target.value })} />
  </div>
  <div className="settings-row">
    <span>发现新文章时</span>
    <Select value={settings.subscriptionNewArticleAction} style={{ width: 160 }}
      data-testid="set-subs-action"
      onChange={(v) => persist({ subscriptionNewArticleAction: v })}
      options={[{ value: 'notify', label: '仅提示' }, { value: 'download', label: '自动下载' }]} />
  </div>
  <p className="faint" style={{ marginTop: 8 }}>检查仅在应用打开时进行；关闭时错过的检查会在下次启动补做一次。</p>
</section>
```
> 说明：`settings` 与 `persist`（封装 `api.saveSettings` + 本地 state 更新）取该页已有的对应实现；若该页用别的变量名/写回函数，按其实际命名接入，**不要新引入第二套状态**。`Switch`/`Select`/`Input` 若未 import 需补到该页的 antd import。

- [ ] **Step 3: 验证类型 + lint + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: 全通过。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/pages/Settings.tsx
git commit -m "feat(settings-ui): subscription auto-check / time / new-article-action controls"
```

---

## Task 8: e2e + 全量验证

**Files:**
- Modify: `tests/e2e/gui.e2e.mjs`

- [ ] **Step 1: 加订阅页 e2e 断言**

订阅检查依赖真实 mp session（e2e 在有缓存 session 时才跑账号链路，见文件末尾 account-mode 分支）。为不依赖网络，断言聚焦「不需要 session 的部分」：导航项存在、进订阅页、空态/列表渲染、设置页三控件存在。在文库相关断言之后、account-mode 分支之前插入：

```js
    // ============ M11 · 订阅 ============
    await win.click('[data-testid="nav-订阅"]')
    await win.waitForSelector('.page-title:has-text("订阅")', { timeout: 10000 })
    assert(true, 'subscriptions page reachable from nav (订阅 between 下载 and 文库)')
    // 之前 M6 用账号模式抓过的号会经历史派生到订阅页；无则为空态。两者都算通过（只断言页面健康渲染）。
    const subsRendered = (await win.locator('[data-testid="subs-list"], .empty-state').count()) >= 1
    assert(subsRendered, 'subscriptions page renders a list or empty-state')
    assert((await win.locator('[data-testid="subs-check-now"]').count()) === 1, 'subscriptions page offers 检查更新')

    // 设置页三个订阅控件
    await win.click('[data-testid="nav-设置"]')
    await win.waitForSelector('[data-testid="set-subs-auto"]', { timeout: 10000 })
    assert((await win.locator('[data-testid="set-subs-time"]').count()) === 1, 'settings has daily check-time control')
    assert((await win.locator('[data-testid="set-subs-action"]').count()) === 1, 'settings has new-article-action control')
```

> 注：插入点需在「回到文库做批量/单篇删除」这些步骤**之前或之后均可，但不能打断阅读器那段连续操作**。建议放在阅读器 + 批量删除全部结束、account-mode 分支之前。运行时按实际行号微调，保证页面跳转顺序自洽。

- [ ] **Step 2: 全量验证（本地）**

Run: `npm test && npm run lint && npx tsc --noEmit -p tsconfig.json && npm run test:e2e`
Expected: 单测全绿（含新增 subscriptions / subscription-schedule / check-subscriptions / settings）；lint/类型干净；e2e 全部 `✓`，末行 `no console/page errors`。

> e2e 只能在主会话/本地跑。Antd v6 汉字按钮文本间会插空格，写 `:has-text` 选择器注意。

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/gui.e2e.mjs
git commit -m "test(e2e): subscriptions page reachable + renders; settings controls present"
```

---

## Self-Review 记录

- **Spec/PRD 覆盖**（对照 `PRD-v0.3.0.md` §4 R2 验收 9 条）：
  - 导航「订阅」在「下载」「文库」之间 → Task 6 Step 3（NAV 顺序）。
  - 仅列出有 fakeid 的号、URL-only 不出现 → Task 1 `accountsFromHistory`（只取 account-kind）+ `mergeAccounts`；Task 5 `subscriptions:list`。
  - 订阅/取消、搜号添加（默认订阅、水位设当前最新）→ Task 5 `setSubscribed`/`addAccount` + `establishWatermark`；Task 6 页面。
  - 设置三项（默认关/09:00/notify）→ Task 4（字段+默认）+ Task 7（控件）。
  - 运行期到点触发 + 启动补检 → Task 2 `shouldCheckNow` + Task 5 scheduler `start()` 立即 tick。
  - 只列表不下载、按配置提示/自动下载 → Task 3 `checkSubscriptions`（RECENT count 列表）+ Task 5 `runSubscriptionCheck`（action 分支）。
  - session 过期不静默、页面引导 → Task 3 auth 抛出 + Task 5 `subsAuthExpired`/`emitSubsUpdated` + Task 6 Alert。
  - 手动「检查更新」→ Task 5 `subscriptions:checkNow` + Task 6 按钮。
  - core 单测 + 订阅页 e2e → Tasks 1–3 测试 + Task 8。
- **类型一致**：`SubscribedAccount`/`ArticleRef` 跨 core/preload/api/页面同名复用；`checkSubscriptions` 的 `AccountCheckResult.latest/newRefs` 与 `runSubscriptionCheck` 用法一致；`Subscriptions` 方法名（`list/getLastRunAt/setLastRunAt/addAccount/setSubscribed/updateWatermark/setNewRefs/clearNewRefs`）在 ipc 调用处一致；settings 字段名（`subscriptionAutoCheck/subscriptionCheckTime/subscriptionNewArticleAction`）测试/默认/UI 三处一致。
- **无 placeholder**：核心逻辑均含确切代码；唯 Task 7 因 `Settings.tsx` 现有写法未知，要求「读现状后按其既有 state/persist 模式接入」，并给出了控件确切代码与字段名——执行时先读该文件。
- **回归点**：`settings.test.ts` 三处整对象断言随字段新增同步更新（Task 4 Step 1）；`subscriptions:list` 读全量历史用 `list(0, 1_000_000)`（History 无「全部」便捷方法，用大 limit 取全量）。
- **诚实约束落地**：scheduler 仅 GUI 模式注册（`registerIpc` 内 `start()`，CLI 模式不调用 `registerIpc`），契合「app 开着才检查」；首 tick 即启动补检。
