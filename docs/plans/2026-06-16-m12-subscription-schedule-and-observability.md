# M12 订阅触发机制升级 + 检查可观测性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 订阅检查支持「每天某时刻」或「每隔 N 小时」两种触发模式，并让每次检查可见——订阅页内检查记录 + 落盘日志 + 下次预计检查时间。

**Architecture:** core 扩 `subscription-schedule`（`ScheduleConfig` 两模式 + `lastScheduledInstant`/`nextScheduledInstant`/`shouldCheckNow`，纯判定）与 `subscriptions`（`checkLog` 存储 + `formatCheckLogLine` 纯格式）。主进程 `runSubscriptionCheck` 收尾留痕（写 `subscriptions.json` 的 checkLog + 追加 `userData/subscriptions-check.log`），`subscriptions:list` 多返回 checkLog 与下次预计，新增 `subscriptions:openLog`。设置页加模式选择，订阅页加检查记录/下次预计/打开日志。

**Tech Stack:** TypeScript（core 无 electron 依赖）、Electron 主进程、React 18 + antd v6、Vitest、Playwright Electron e2e。

设计依据：`docs/superpowers/specs/2026-06-16-m12-subscription-schedule-and-observability-design.md`；验收 `docs/PRD-v0.3.0.md` §4 R3。

**任务顺序要点**：先加 settings 字段（Task 1），再改 schedule（Task 2，含 scheduler 调用点读新字段），保证每个任务结束 `tsc` 干净。

---

## 文件结构

- **Modify** `electron/services/settings.ts` — 加 `subscriptionScheduleMode` / `subscriptionIntervalHours`。
- **Modify** `tests/electron/settings.test.ts` — 三处整对象断言同步 + 加一条。
- **Modify** `src/core/subscription-schedule.ts` — `ScheduleConfig` 两模式 + 三个纯函数。
- **Modify** `tests/core/subscription-schedule.test.ts` — 按新签名重写 + 补 interval/next 分支。
- **Modify** `electron/services/subscription-scheduler.ts` — tick 传 config。
- **Modify** `src/core/subscriptions.ts` — `CheckLogEntry` + `checkLog` 存储 + `formatCheckLogLine`。
- **Modify** `tests/core/subscriptions.test.ts` — 补 checkLog/格式化测试。
- **Modify** `electron/ipc.ts` — `runSubscriptionCheck(trigger)` 留痕、`subscriptions:list` 返 checkLog/nextCheckAt、`subscriptions:openLog`。
- **Modify** `electron/preload.ts` / `src/renderer/api.ts` — `subscriptionsOpenLog`、`SubscriptionsState` 加字段。
- **Modify** `src/renderer/pages/Settings.tsx` — 模式选择 + 条件控件。
- **Modify** `src/renderer/pages/Subscriptions.tsx` — 检查记录 / 下次预计 / 打开日志。
- **Modify** `tests/e2e/gui.e2e.mjs` — 设置模式切换 + 订阅页新元素断言。

---

## Task 1: settings 加调度模式字段

**Files:**
- Modify: `electron/services/settings.ts`
- Test: `tests/electron/settings.test.ts`

- [ ] **Step 1: 先改测试（会失败）**

`tests/electron/settings.test.ts` 三处整对象 `toEqual` 各追加 `subscriptionScheduleMode: 'daily', subscriptionIntervalHours: 6`。

第 1 处（returns defaults）整对象改为：
```ts
    expect(v).toEqual({ libraryRoot: '/default/lib', defaultFormats: ['md', 'html', 'meta'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify', subscriptionScheduleMode: 'daily', subscriptionIntervalHours: 6 })
```

第 2 处（persists and reloads）：
```ts
    expect(await s2.get()).toEqual({ libraryRoot: '/custom', defaultFormats: ['md', 'pdf'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify', subscriptionScheduleMode: 'daily', subscriptionIntervalHours: 6 })
```

第 3 处（merges partial save）：
```ts
    expect(await s.get()).toEqual({ libraryRoot: '/custom', defaultFormats: ['html'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 }, subscriptionAutoCheck: false, subscriptionCheckTime: '09:00', subscriptionNewArticleAction: 'notify', subscriptionScheduleMode: 'daily', subscriptionIntervalHours: 6 })
```

在 describe 末尾新增：
```ts
  it('persists schedule mode and interval', async () => {
    const s = new SettingsService(dir, '/default/lib')
    await s.save({ subscriptionScheduleMode: 'interval', subscriptionIntervalHours: 4 })
    const v = await new SettingsService(dir, '/default/lib').get()
    expect(v.subscriptionScheduleMode).toBe('interval')
    expect(v.subscriptionIntervalHours).toBe(4)
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/electron/settings.test.ts`
Expected: FAIL —— 默认值不含新字段 / 类型缺失。

- [ ] **Step 3: 实现**

`electron/services/settings.ts` 的 `AppSettings` 增字段（在 `subscriptionNewArticleAction` 之后）：
```ts
  subscriptionScheduleMode: 'daily' | 'interval'
  subscriptionIntervalHours: number
```

`defaults()` 增默认（在 `subscriptionNewArticleAction: 'notify',` 之后）：
```ts
      subscriptionScheduleMode: 'daily',
      subscriptionIntervalHours: 6,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/electron/settings.test.ts`
Expected: PASS（6 条）。

- [ ] **Step 5: 提交**

```bash
git add electron/services/settings.ts tests/electron/settings.test.ts
git commit -m "feat(settings): add subscription schedule mode + interval hours"
```

---

## Task 2: subscription-schedule 两模式 + 下次预计

**Files:**
- Modify: `src/core/subscription-schedule.ts`
- Modify: `tests/core/subscription-schedule.test.ts`
- Modify: `electron/services/subscription-scheduler.ts`

- [ ] **Step 1: 按新签名重写测试**

整体替换 `tests/core/subscription-schedule.test.ts` 为：
```ts
import { describe, it, expect } from 'vitest'
import { shouldCheckNow, lastScheduledInstant, nextScheduledInstant } from '../../src/core/subscription-schedule'

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()
const daily = { mode: 'daily' as const, checkTime: '09:00', intervalHours: 6 }
const interval = (n: number) => ({ mode: 'interval' as const, checkTime: '09:00', intervalHours: n })

describe('shouldCheckNow · daily', () => {
  it('false when autoCheck off', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 10, 0), lastCheckedAt: null, autoCheck: false, config: daily })).toBe(false)
  })
  it('false before the scheduled time', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 8, 59), lastCheckedAt: null, autoCheck: true, config: daily })).toBe(false)
  })
  it('true after scheduled time, never checked', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 9, 1), lastCheckedAt: null, autoCheck: true, config: daily })).toBe(true)
  })
  it('false when already checked today', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 12, 0), lastCheckedAt: at(2026, 6, 16, 9, 1), autoCheck: true, config: daily })).toBe(false)
  })
  it('true (launch catch-up) when last check was before today’s slot', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 10, 0), lastCheckedAt: at(2026, 6, 15, 9, 1), autoCheck: true, config: daily })).toBe(true)
  })
})

describe('shouldCheckNow · interval (grid anchored at midnight)', () => {
  it('fires at the latest grid slot when never checked', () => {
    // N=6 → slots 0/6/12/18; now 13:00 → slot 12:00 reached
    expect(shouldCheckNow({ now: at(2026, 6, 16, 13, 0), lastCheckedAt: null, autoCheck: true, config: interval(6) })).toBe(true)
  })
  it('false when already checked since the latest slot', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 13, 0), lastCheckedAt: at(2026, 6, 16, 12, 30), autoCheck: true, config: interval(6) })).toBe(false)
  })
  it('true when last check predates the latest slot', () => {
    expect(shouldCheckNow({ now: at(2026, 6, 16, 13, 0), lastCheckedAt: at(2026, 6, 16, 11, 0), autoCheck: true, config: interval(6) })).toBe(true)
  })
})

describe('lastScheduledInstant', () => {
  it('daily returns null before the time, the slot after', () => {
    expect(lastScheduledInstant(at(2026, 6, 16, 8, 0), daily)).toBeNull()
    expect(lastScheduledInstant(at(2026, 6, 16, 9, 30), daily)).toBe(at(2026, 6, 16, 9, 0))
  })
  it('interval snaps to the latest midnight-anchored slot', () => {
    expect(lastScheduledInstant(at(2026, 6, 16, 13, 0), interval(6))).toBe(at(2026, 6, 16, 12, 0))
    expect(lastScheduledInstant(at(2026, 6, 16, 1, 0), interval(6))).toBe(at(2026, 6, 16, 0, 0))
  })
})

describe('nextScheduledInstant', () => {
  it('daily → today if before, tomorrow if after', () => {
    expect(nextScheduledInstant(at(2026, 6, 16, 8, 0), daily)).toBe(at(2026, 6, 16, 9, 0))
    expect(nextScheduledInstant(at(2026, 6, 16, 10, 0), daily)).toBe(at(2026, 6, 17, 9, 0))
  })
  it('interval → next grid slot, divisor case', () => {
    expect(nextScheduledInstant(at(2026, 6, 16, 13, 0), interval(6))).toBe(at(2026, 6, 16, 18, 0))
  })
  it('interval → non-divisor last segment collapses to next midnight', () => {
    // N=5 → slots 0/5/10/15/20; now 22:00 → next is next-day 0:00 (not 25:00)
    expect(nextScheduledInstant(at(2026, 6, 16, 22, 0), interval(5))).toBe(at(2026, 6, 17, 0, 0))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/subscription-schedule.test.ts`
Expected: FAIL —— `lastScheduledInstant`/`nextScheduledInstant` 不存在、`shouldCheckNow` 签名不符。

- [ ] **Step 3: 实现**

整体替换 `src/core/subscription-schedule.ts` 为：
```ts
// src/core/subscription-schedule.ts
// 运行期定时检查的纯判定：app 必须开着才检查；启动时若当前计划时刻已过且未检查则补检一次。
// 两种模式：daily（每天某时刻）/ interval（每隔 N 小时，网格锚定每天 0 点）。
export type ScheduleMode = 'daily' | 'interval'
export interface ScheduleConfig {
  mode: ScheduleMode
  checkTime: string       // "HH:MM"（daily）
  intervalHours: number   // 小时（interval）
}
export interface ScheduleInput {
  now: number                  // unix ms
  lastCheckedAt: number | null // 上次检查运行的 unix ms
  autoCheck: boolean
  config: ScheduleConfig
}

function startOfDay(now: number): number {
  const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime()
}
function dailyTs(now: number, checkTime: string): number {
  const d = new Date(now); const [h, m] = checkTime.split(':').map(Number); d.setHours(h, m, 0, 0); return d.getTime()
}

/** 当前已过的最近一个计划时刻；daily 在今天时刻前返回 null（今天还没到点）。 */
export function lastScheduledInstant(now: number, config: ScheduleConfig): number | null {
  if (config.mode === 'interval') {
    const midnight = startOfDay(now)
    const slotMs = Math.max(1, config.intervalHours) * 3600_000
    const k = Math.floor((now - midnight) / slotMs)
    return midnight + k * slotMs
  }
  const ts = dailyTs(now, config.checkTime)
  return now >= ts ? ts : null
}

/** 下次预计检查时刻（供页面显示）。interval 末段不足 N 小时则收口到次日 0 点。 */
export function nextScheduledInstant(now: number, config: ScheduleConfig): number {
  if (config.mode === 'interval') {
    const midnight = startOfDay(now)
    const slotMs = Math.max(1, config.intervalHours) * 3600_000
    const k = Math.floor((now - midnight) / slotMs)
    const candidate = midnight + (k + 1) * slotMs
    const nextMidnight = midnight + 24 * 3600_000
    return Math.min(candidate, nextMidnight)
  }
  const ts = dailyTs(now, config.checkTime)
  return now < ts ? ts : ts + 24 * 3600_000
}

/** 现在是否该触发一次检查。 */
export function shouldCheckNow(i: ScheduleInput): boolean {
  if (!i.autoCheck) return false
  const inst = lastScheduledInstant(i.now, i.config)
  if (inst == null) return false
  return i.lastCheckedAt == null || i.lastCheckedAt < inst
}
```

- [ ] **Step 4: 更新 scheduler 调用点（传 config）**

`electron/services/subscription-scheduler.ts` 的 `tick` 里把 `shouldCheckNow` 调用改为传 config：
```ts
      if (shouldCheckNow({
        now, lastCheckedAt: lastRunAt, autoCheck: true,
        config: { mode: s.subscriptionScheduleMode, checkTime: s.subscriptionCheckTime, intervalHours: s.subscriptionIntervalHours },
      })) {
        await this.deps.runCheck()
      }
```

- [ ] **Step 5: 跑测试 + 类型确认通过**

Run: `npx vitest run tests/core/subscription-schedule.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: 单测 PASS（13 条）；tsc 干净（scheduler 调用点已对齐）。

- [ ] **Step 6: 提交**

```bash
git add src/core/subscription-schedule.ts tests/core/subscription-schedule.test.ts electron/services/subscription-scheduler.ts
git commit -m "feat(core): schedule modes (daily/interval grid) + nextScheduledInstant"
```

---

## Task 3: subscriptions 检查日志存储 + 格式化

**Files:**
- Modify: `src/core/subscriptions.ts`
- Test: `tests/core/subscriptions.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `tests/core/subscriptions.test.ts` 文件末尾追加：
```ts
import { formatCheckLogLine } from '../../src/core/subscriptions'

describe('Subscriptions checkLog', () => {
  let d2: string
  beforeEach(() => { d2 = mkdtempSync(join(tmpdir(), 'wxk-subslog-')) })

  it('appends newest-first and keeps at most 50', async () => {
    const s = new Subscriptions(d2)
    for (let i = 0; i < 55; i++) await s.appendCheckLog({ time: i, trigger: 'auto', accounts: 1, newFound: 0, failed: 0 })
    const log = await s.getCheckLog()
    expect(log).toHaveLength(50)
    expect(log[0].time).toBe(54)   // newest first
    expect(log[49].time).toBe(5)
  })

  it('getCheckLog empty when none', async () => {
    expect(await new Subscriptions(d2).getCheckLog()).toEqual([])
  })
})

describe('formatCheckLogLine', () => {
  it('formats with and without note', () => {
    const line = formatCheckLogLine({ time: Date.parse('2026-06-16T01:00:00Z'), trigger: 'manual', accounts: 3, newFound: 2, failed: 1 })
    expect(line).toContain('MANUAL')
    expect(line).toContain('accounts=3')
    expect(line).toContain('new=2')
    expect(line).toContain('failed=1')
    expect(formatCheckLogLine({ time: 0, trigger: 'auto', accounts: 0, newFound: 0, failed: 0, note: 'no-session' })).toContain('note=no-session')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/subscriptions.test.ts`
Expected: FAIL —— `appendCheckLog`/`getCheckLog`/`formatCheckLogLine` 不存在。

- [ ] **Step 3: 实现**

`src/core/subscriptions.ts`：

在 `SubscribedAccount` 接口之后、`SubscriptionsFile` 之前加类型与纯格式函数：
```ts
export interface CheckLogEntry {
  time: number                       // unix ms
  trigger: 'auto' | 'manual'
  accounts: number                   // 本次检查的订阅号数
  newFound: number                   // 发现的新文章总数
  failed: number                     // 失败的号数
  note?: string                      // 特殊情形：'no-session' | 'auth-expired' | 'no-accounts'
}

/** 落盘日志的一行（人类可读）。纯函数。 */
export function formatCheckLogLine(e: CheckLogEntry): string {
  const base = `[${new Date(e.time).toISOString()}] ${e.trigger === 'auto' ? 'AUTO' : 'MANUAL'} accounts=${e.accounts} new=${e.newFound} failed=${e.failed}`
  return e.note ? `${base} note=${e.note}` : base
}
```

把 `SubscriptionsFile` 接口加 `checkLog`：
```ts
interface SubscriptionsFile { version: 1; lastRunAt: number | null; accounts: SubscribedAccount[]; checkLog: CheckLogEntry[] }
```

`read()` 的 ENOENT 默认值加 `checkLog: []`：
```ts
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, lastRunAt: null, accounts: [], checkLog: [] }
```

在类内（`clearNewRefs` 之后）加方法：
```ts
  async getCheckLog(): Promise<CheckLogEntry[]> { return (await this.read()).checkLog ?? [] }
  async appendCheckLog(entry: CheckLogEntry, keep = 50): Promise<void> {
    await this.mutate((d) => { d.checkLog = [entry, ...(d.checkLog ?? [])].slice(0, keep) })
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/subscriptions.test.ts`
Expected: PASS（原 6 条 + 新 3 条 = 9 条）。

- [ ] **Step 5: 提交**

```bash
git add src/core/subscriptions.ts tests/core/subscriptions.test.ts
git commit -m "feat(core): subscriptions checkLog store (keep 50) + formatCheckLogLine"
```

---

## Task 4: 主进程 — 留痕 + 下次预计 + 打开日志

**Files:**
- Modify: `electron/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/renderer/api.ts`

- [ ] **Step 1: ipc.ts import 补齐**

`electron/ipc.ts` 顶部：把第 2 行 electron import 加 `app`，node:fs 补 `appendFileSync`/`writeFileSync`，并 import `join`、新符号。

第 2 行改为：
```ts
import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron'
```
第 3 行 `import { readdir } from 'node:fs/promises'` 之后加：
```ts
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
```
把 `import { Subscriptions, accountsFromHistory, mergeAccounts } from '../src/core/subscriptions'` 改为：
```ts
import { Subscriptions, accountsFromHistory, mergeAccounts, formatCheckLogLine, type CheckLogEntry } from '../src/core/subscriptions'
```
把 `import { checkSubscriptions } from '../src/core/check-subscriptions'` 之后加：
```ts
import { nextScheduledInstant } from '../src/core/subscription-schedule'
```

- [ ] **Step 2: 留痕 helper + 改造 runSubscriptionCheck（带 trigger）**

在 `electron/ipc.ts` 的订阅区，把现有 `runSubscriptionCheck` 整体替换，并在其前加日志路径与 helper。即把从 `const runSubscriptionCheck = async () => {` 到其结尾 `}` 的整段替换为：
```ts
  const logPath = join(app.getPath('userData'), 'subscriptions-check.log')
  const logCheck = async (subs: Subscriptions, entry: CheckLogEntry) => {
    try { await subs.appendCheckLog(entry); appendFileSync(logPath, formatCheckLogLine(entry) + '\n') }
    catch { /* 留痕失败不阻断检查主流程 */ }
  }

  const runSubscriptionCheck = async (trigger: 'auto' | 'manual') => {
    const subs = await subsFor()
    const session = getSession()
    if (!session) {
      subsAuthExpired = true
      await logCheck(subs, { time: Date.now(), trigger, accounts: 0, newFound: 0, failed: 0, note: 'no-session' })
      emitSubsUpdated(); return
    }
    const accounts = (await subs.list()).filter((a) => a.subscribed)
    if (!accounts.length) {
      await subs.setLastRunAt(Date.now())
      await logCheck(subs, { time: Date.now(), trigger, accounts: 0, newFound: 0, failed: 0, note: 'no-accounts' })
      emitSubsUpdated(); return
    }
    const s = await settings.get()
    let results
    try {
      results = await checkSubscriptions(accounts, { mpFetch: makeMpFetch(session), token: session.token })
    } catch (e) {
      if (e instanceof MpAuthExpired) {
        subsAuthExpired = true
        await logCheck(subs, { time: Date.now(), trigger, accounts: accounts.length, newFound: 0, failed: accounts.length, note: 'auth-expired' })
        emitSubsUpdated(); return
      }
      throw e
    }
    subsAuthExpired = false
    let newFound = 0
    let failed = 0
    for (const r of results) {
      if (!r.ok) { failed++; continue }
      await subs.updateWatermark(r.fakeid, r.latest)
      if (r.newRefs.length === 0) continue
      newFound += r.newRefs.length
      if (s.subscriptionNewArticleAction === 'download') {
        const acc = accounts.find((a) => a.fakeid === r.fakeid)!
        await downloadRefs(r.newRefs, s.defaultFormats, { kind: 'account', nickname: acc.nickname, fakeid: r.fakeid, range: { count: r.newRefs.length } })
        await subs.clearNewRefs(r.fakeid)
      } else {
        await subs.setNewRefs(r.fakeid, r.newRefs)
      }
    }
    await subs.setLastRunAt(Date.now())
    await logCheck(subs, { time: Date.now(), trigger, accounts: accounts.length, newFound, failed })
    emitSubsUpdated()
  }
```

- [ ] **Step 3: list 返 checkLog/nextCheckAt、checkNow 带 trigger、新增 openLog、scheduler 传 manual/auto**

把 `subscriptions:list` 处理器替换为（多返回 checkLog 与 nextCheckAt）：
```ts
  ipcMain.handle('subscriptions:list', async () => {
    const { events } = await (await historyFor()).list(0, 1_000_000)
    const subs = await subsFor()
    const merged = mergeAccounts(accountsFromHistory(events), await subs.list())
    const s = await settings.get()
    const nextCheckAt = s.subscriptionAutoCheck
      ? nextScheduledInstant(Date.now(), { mode: s.subscriptionScheduleMode, checkTime: s.subscriptionCheckTime, intervalHours: s.subscriptionIntervalHours })
      : null
    return { accounts: merged, authExpired: subsAuthExpired, lastRunAt: await subs.getLastRunAt(), checkLog: await subs.getCheckLog(), nextCheckAt }
  })
```

把 `subscriptions:checkNow` 处理器替换为：
```ts
  ipcMain.handle('subscriptions:checkNow', async () => { await runSubscriptionCheck('manual') })
```

在 `subscriptions:dismissNew` 处理器之后、`new SubscriptionScheduler(...)` 之前加：
```ts
  ipcMain.handle('subscriptions:openLog', () => {
    try { writeFileSync(logPath, '', { flag: 'a' }) } catch { /* 确保文件存在即可 */ }
    shell.showItemInFolder(logPath)
  })
```

把 scheduler 构造改为传 `'auto'` 给 runCheck：
```ts
  new SubscriptionScheduler({ settings, subsFor, runCheck: () => runSubscriptionCheck('auto') }).start()
```

- [ ] **Step 4: preload + api 类型**

`electron/preload.ts` 的 `onSubscriptionsUpdated` 之前加：
```ts
  subscriptionsOpenLog: () => ipcRenderer.invoke('subscriptions:openLog'),
```

`src/renderer/api.ts`：
把 `import type { SubscribedAccount } from '../core/subscriptions'` 改为：
```ts
import type { SubscribedAccount, CheckLogEntry } from '../core/subscriptions'
```
把 `export type { SubscribedAccount } from '../core/subscriptions'` 改为：
```ts
export type { SubscribedAccount, CheckLogEntry } from '../core/subscriptions'
```
把 `SubscriptionsState` 接口改为：
```ts
export interface SubscriptionsState { accounts: SubscribedAccount[]; authExpired: boolean; lastRunAt: number | null; checkLog: CheckLogEntry[]; nextCheckAt: number | null }
```
在 `WxApi` 的 `onSubscriptionsUpdated` 之前加：
```ts
  subscriptionsOpenLog(): Promise<void>
```

- [ ] **Step 5: 验证类型 + lint + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: 全通过。

- [ ] **Step 6: 提交**

```bash
git add electron/ipc.ts electron/preload.ts src/renderer/api.ts
git commit -m "feat(main): check-log persistence + on-disk log + nextCheckAt + openLog"
```

---

## Task 5: renderer — 设置模式选择 + 订阅页可观测性

**Files:**
- Modify: `src/renderer/pages/Settings.tsx`
- Modify: `src/renderer/pages/Subscriptions.tsx`

- [ ] **Step 1: 设置页模式选择**

`src/renderer/pages/Settings.tsx`：把 antd import 加 `Segmented`、`InputNumber` 已在（确认 import 行含 `InputNumber`，已有；补 `Segmented`）：
```ts
import { Input, Button, Space, InputNumber, Popconfirm, Switch, Select, Segmented, message } from 'antd'
```

把订阅区里「每日检查时刻」那一段（当前 `<Space align="center"><span ...>每日检查时刻</span><input type="time" .../></Space>`）替换为「模式选择 + 条件控件」：
```tsx
              <Space align="center">
                <span style={{ minWidth: 96, display: 'inline-block' }}>检查频率</span>
                <Segmented value={s.subscriptionScheduleMode} data-testid="set-subs-mode"
                  onChange={(v) => setS({ ...s, subscriptionScheduleMode: v as 'daily' | 'interval' })}
                  options={[{ label: '每天某时刻', value: 'daily' }, { label: '每隔N小时', value: 'interval' }]} />
              </Space>
              {s.subscriptionScheduleMode === 'daily' ? (
                <Space align="center">
                  <span style={{ minWidth: 96, display: 'inline-block' }}>每日检查时刻</span>
                  <input type="time" value={s.subscriptionCheckTime} data-testid="set-subs-time"
                    onChange={(e) => setS({ ...s, subscriptionCheckTime: e.target.value })}
                    style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }} />
                </Space>
              ) : (
                <Space align="center">
                  <span style={{ minWidth: 96, display: 'inline-block' }}>每隔</span>
                  <InputNumber min={1} max={24} value={s.subscriptionIntervalHours} data-testid="set-subs-interval"
                    onChange={(v) => setS({ ...s, subscriptionIntervalHours: v ?? 6 })} addonAfter="小时" />
                </Space>
              )}
```

- [ ] **Step 2: 订阅页 — 下次预计 / 打开日志 / 检查记录**

`src/renderer/pages/Subscriptions.tsx`：

把 import 的 antd 行加 `Typography`（用于小字说明，可选）——保持现有 import 即可，无需新增组件。state 增 checkLog/nextCheckAt：
在 `const [candidates, setCandidates] = useState<MpAccount[]>([])` 之后加：
```tsx
  const [checkLog, setCheckLog] = useState<import('../api').SubscriptionsState['checkLog']>([])
  const [nextCheckAt, setNextCheckAt] = useState<number | null>(null)
```
把 `load` 内 `setAccounts(s.accounts); setAuthExpired(s.authExpired)` 改为：
```tsx
      const s = await api.subscriptionsList(); setAccounts(s.accounts); setAuthExpired(s.authExpired); setCheckLog(s.checkLog); setNextCheckAt(s.nextCheckAt)
```

在「检查更新」按钮所在的工具行（`</div>` 收尾）之后、`{candidates.length > 0 && (...)}` 之前，插入「下次预计 + 打开日志」一行：
```tsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 13 }} className="faint">
          <span data-testid="subs-next-check">下次预计检查：{nextCheckAt ? new Date(nextCheckAt).toLocaleString() : '未开启自动检查'}</span>
          <a onClick={() => api.subscriptionsOpenLog()} data-testid="subs-open-log">打开日志文件</a>
        </div>
```

在页面最外层 `fade-in` 容器的末尾（账号 List 之后、最外层闭合 `</div>` 之前）插入「检查记录」区：
```tsx
        <div style={{ marginTop: 24 }} data-testid="subs-check-log">
          <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>检查记录</h3>
          {checkLog.length === 0 ? <div className="faint" style={{ fontSize: 13 }}>还没有检查记录。开启自动检查或点「检查更新」后，这里会留痕。</div>
            : <List size="small" dataSource={checkLog.slice(0, 10)} renderItem={(e) => (
                <List.Item>
                  <span style={{ fontSize: 12.5 }}>
                    {new Date(e.time).toLocaleString()} · {e.trigger === 'auto' ? '自动' : '手动'} · 查 {e.accounts} 号 · 新 {e.newFound} · 失败 {e.failed}{e.note ? ` · ${e.note}` : ''}
                  </span>
                </List.Item>
              )} />}
        </div>
```

- [ ] **Step 3: 验证类型 + lint + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: 全通过。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/pages/Settings.tsx src/renderer/pages/Subscriptions.tsx
git commit -m "feat(renderer): schedule-mode selector + check log / next-check / open-log UI"
```

---

## Task 6: e2e + 全量验证

**Files:**
- Modify: `tests/e2e/gui.e2e.mjs`

- [ ] **Step 1: 扩订阅/设置 e2e 断言**

在 M11 订阅断言段（含 `subscriptions page offers 检查更新` 与设置三控件那几行）内补 M12 元素。把该段替换为：
```js
    // ============ M11/M12 · 订阅 ============
    await win.click('[data-testid="nav-订阅"]')
    await win.waitForSelector('.page-title:has-text("订阅")', { timeout: 10000 })
    assert(true, 'subscriptions page reachable from nav (订阅 between 下载 and 文库)')
    const subsRendered = (await win.locator('[data-testid="subs-list"], .empty-state').count()) >= 1
    assert(subsRendered, 'subscriptions page renders a list or empty-state')
    assert((await win.locator('[data-testid="subs-check-now"]').count()) === 1, 'subscriptions page offers 检查更新')
    // M12: 可观测性元素
    assert((await win.locator('[data-testid="subs-next-check"]').count()) === 1, 'subscriptions page shows next-check line')
    assert((await win.locator('[data-testid="subs-open-log"]').count()) === 1, 'subscriptions page offers open-log link')
    assert((await win.locator('[data-testid="subs-check-log"]').count()) === 1, 'subscriptions page has a check-log section')

    // 设置页：订阅控件 + M12 调度模式切换
    await win.click('[data-testid="nav-设置"]')
    await win.waitForSelector('[data-testid="set-subs-auto"]', { timeout: 10000 })
    assert((await win.locator('[data-testid="set-subs-action"]').count()) === 1, 'settings has new-article-action control')
    assert((await win.locator('[data-testid="set-subs-mode"]').count()) === 1, 'settings has schedule-mode selector')
    // 默认 daily 显示时刻控件；切到 interval 显示小时控件
    assert((await win.locator('[data-testid="set-subs-time"]').count()) === 1, 'daily mode shows the time control')
    await win.click('[data-testid="set-subs-mode"] label:has-text("每隔")')
    await win.waitForSelector('[data-testid="set-subs-interval"]', { timeout: 5000 })
    assert((await win.locator('[data-testid="set-subs-interval"]').count()) === 1, 'switching to interval mode shows the hours control')
```

> 注：M11 原断言里「`settings has daily check-time control`」改由本段「daily mode shows the time control」覆盖；删除原先重复的 set-subs-time 断言行以免冲突（本段已含）。运行时按实际行号核对，保证不重复断言同一 testid。

- [ ] **Step 2: 全量验证（本地）**

Run: `npm test && npm run lint && npx tsc --noEmit -p tsconfig.json && npm run test:e2e`
Expected: 单测全绿（含 schedule 13 / subscriptions 9 / settings 6）；lint/类型干净；e2e 全部 `✓`，末行 `no console/page errors`。

> e2e 只能在主会话/本地跑。Antd v6 的 Segmented 选项 label 含汉字，`:has-text("每隔")` 可命中「每隔N小时」。

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/gui.e2e.mjs
git commit -m "test(e2e): schedule-mode switch + subscription observability elements"
```

---

## Self-Review 记录

- **Spec/PRD 覆盖**（对照 `PRD-v0.3.0.md` §4 R3 七条）：
  - 两模式可选、默认 daily → Task 1（字段默认）+ Task 5（Segmented）。
  - interval 网格锚 0 点 + 启动补检 → Task 2（`lastScheduledInstant`/`shouldCheckNow` 各分支单测）。
  - 检查记录区倒序最近 10 → Task 3（`appendCheckLog` 留 50 倒序）+ Task 5（slice(0,10) 渲染）。
  - 落盘日志 + 打开日志 → Task 4（`logCheck` 追加文件 + `subscriptions:openLog`）+ Task 5（链接）。
  - 下次预计检查 → Task 2（`nextScheduledInstant`）+ Task 4（list 返 nextCheckAt）+ Task 5（行显示）。
  - checkLog 留 50 / 格式单测 / 写盘失败不阻断 → Task 3（测试）+ Task 4（`logCheck` try/catch）。
  - core TDD + e2e → Tasks 1–3 测试 + Task 6。
- **类型一致**：`ScheduleConfig`/`ScheduleMode` 在 schedule 定义，scheduler 与 ipc 构造同形 `{mode,checkTime,intervalHours}`；`CheckLogEntry` 在 subscriptions 定义、ipc/api 复用同名导出；`SubscriptionsState` 加 `checkLog`/`nextCheckAt` 与 ipc 返回一致；settings 字段名（`subscriptionScheduleMode`/`subscriptionIntervalHours`）测试/默认/scheduler/ipc/UI 全一致。
- **任务顺序**：settings 字段（T1）先于 schedule 改签名（T2，含 scheduler 调用点同步），每个任务结束 tsc 干净；T2 同任务内改 schedule + scheduler 避免悬空签名。
- **无 placeholder**：每步含确切代码/命令。e2e 段标注「按实际行号核对避免重复断言」，因 M11 已有 set-subs-time 断言、本段接管。
