# M12 设计：订阅触发机制升级 + 检查可观测性

> 设计文档（spec）。定「做什么、为什么、边界」。实现计划见 `docs/plans/`；需求与验收并入 `docs/PRD-v0.3.0.md`（R3）。
> 状态：设计已确认（2026-06-16，安哥）。建立在 M11（公众号订阅）之上。

## 概览

M11 的订阅检查只支持「每天某时刻」，且用户无法确知定时是否真的跑过。M12 两件事：

1. **触发机制升级**：两种模式二选一——「每天某时刻」或「每隔 N 小时」（网格锚定每天 0 点）。
2. **检查可观测性**：每次检查留痕——订阅页内「检查记录」+ 落盘日志文件 + 「下次预计检查」时间。

单里程碑，不拆分。改动集中在 `subscription-schedule`（纯判定扩展）、`subscriptions`（检查日志存储）、主进程编排、设置/订阅两个页面。

## 1. 触发机制：两种模式

### 配置

`AppSettings` 增/留：
- `subscriptionScheduleMode: 'daily' | 'interval'`（默认 `'daily'`，**不改老用户行为**）
- `subscriptionCheckTime: string`（daily 模式，"HH:MM"，默认 `'09:00'`，语义不变）
- `subscriptionIntervalHours: number`（interval 模式，默认 `6`，最小 1）

### 判定逻辑（统一抽象）

核心抽象：**「当前已过的最近一个计划时刻」**（`lastScheduledInstant`）。`shouldCheckNow` = 该时刻存在且 `lastRunAt < 该时刻`。

- **daily**：计划时刻 = 今天的 `checkTime`。`now < 今天checkTime` → 返回 null（今天还没到点，不触发）。
- **interval**：网格锚定**每天 0 点**。`slotMs = intervalHours * 3600_000`；`midnight = 当天0点`；`k = floor((now - midnight) / slotMs)`；计划时刻 = `midnight + k * slotMs`。N=6 → 0/6/12/18 点；N=5 → 0/5/10/15/20 点，末段不足 N 小时、每天 0 点重置。interval 模式恒有计划时刻（最早即当天 0 点）。

这天然涵盖**启动补检**：app 在某计划时刻没开着，启动时 `now` 已过该时刻且 `lastRunAt` 早于它 → 立即补一次。与「单进程、app 开着才跑」一致。

### 下次预计（供页面显示）

`nextScheduledInstant(now, config)`：
- daily：`now < 今天checkTime` → 今天 checkTime；否则明天 checkTime。
- interval：`候选 = lastSlot + slotMs`；`次日0点 = midnight + 24h`；取 `min(候选, 次日0点)`（非整除时末段在 0 点收口）。

均为纯函数。

## 2. 可观测性

### 检查日志条目

```ts
export interface CheckLogEntry {
  time: number                       // unix ms
  trigger: 'auto' | 'manual'         // 定时触发 / 手动「检查更新」
  accounts: number                   // 本次检查的订阅号数
  newFound: number                   // 发现的新文章总数
  failed: number                     // 失败的号数
  note?: string                      // 特殊情形：'no-session' | 'auth-expired' | 'no-accounts'
}
```

### 三处呈现

- **页内「检查记录」区**（订阅页）：倒序列最近 ~10 条——「时间 · 自动/手动 · 查 N 个号 · 新 M 篇 · 失败 K（· note）」。这是「定时确实生效」的直接证据：开了自动检查、到点后这里冒出 `auto` 条目。
- **落盘日志**：人类可读、全量追加到 **`userData/subscriptions-check.log`**（app 数据区，不污染用户浏览的文库目录，与 `mp-session.json` 同处）。格式由纯函数 `formatCheckLogLine` 生成。订阅页给「打开日志文件」链接（`shell.showItemInFolder`）。
- **下次预计检查**（订阅页一行）：按当前模式 + now 算 `nextScheduledInstant`；未开自动检查则显示「未开启自动检查」。

### 存储边界

- `subscriptions.json` 加 `checkLog: CheckLogEntry[]`，**只留最近 50 条**（`appendCheckLog` 截断），驱动页面、不无限涨。
- 全量历史在 `subscriptions-check.log`（追加写，单文件，无轮转——YAGNI）。

## 3. 数据 / 文件影响

- `settings.json`：加 `subscriptionScheduleMode`、`subscriptionIntervalHours`。
- `subscriptions.json`：加 `checkLog`（留 50）。
- 新文件 `userData/subscriptions-check.log`（追加写）。

## 4. 改动落点

- **core `src/core/subscription-schedule.ts`**：`ScheduleMode`/`ScheduleConfig` 类型；`lastScheduledInstant`、`nextScheduledInstant`、`shouldCheckNow(扩为含 config)`。纯函数全分支单测。
- **core `src/core/subscriptions.ts`**：`CheckLogEntry` 类型；`SubscriptionsFile` 加 `checkLog`；方法 `appendCheckLog(entry, keep=50)`、`getCheckLog()`；纯函数 `formatCheckLogLine`。
- **main `electron/ipc.ts`**：`runSubscriptionCheck` 收尾组装 `CheckLogEntry` → `appendCheckLog` + 追加 `formatCheckLogLine` 到 `userData/subscriptions-check.log`；`runCheck` 带 `trigger` 参数（scheduler 传 `'auto'`，`checkNow` 传 `'manual'`）。`subscriptions:list` 返回追加 `checkLog` 与 `nextCheckAt`（按 config + now 算，未开自动检查为 null）。新增 `subscriptions:openLog`（reveal 日志文件）。
- **main `electron/services/subscription-scheduler.ts`**：tick 把 `{ mode, checkTime, intervalHours }` 组成 config 传 `shouldCheckNow`。
- **main `electron/services/settings.ts`**：加两字段 + 默认。
- **renderer `src/renderer/pages/Settings.tsx`**：模式选择（Segmented：每天某时刻 / 每隔N小时），条件显示时刻或小时数控件。
- **renderer `src/renderer/pages/Subscriptions.tsx`**：加「检查记录」区、「下次预计检查」行、「打开日志文件」链接。
- **bridge**：`preload.ts` + `src/renderer/api.ts` 加 `subscriptionsOpenLog`，`SubscriptionsState` 加 `checkLog`/`nextCheckAt`。

## 5. 错误处理

- 日志写盘失败（磁盘/权限）不得阻断检查主流程——`try/catch` 吞掉、仅影响留痕。
- `checkLog` 读到损坏：沿用 `subscriptions.json` 损坏即报「删除以重置」的现有策略（同一文件）。

## 6. 测试

- **core 纯逻辑 TDD**：`shouldCheckNow`（daily：未到点/到点未检/已检；interval：网格点/启动补检/非整除末段）、`nextScheduledInstant`（两模式 + 跨日）、`formatCheckLogLine`（含 note）、`appendCheckLog`（留 50、倒序取最近）。
- **主进程接线 build + e2e**：e2e 断言——设置页模式可切换（每天⇄每隔N小时，对应控件切换）、订阅页「检查记录」区 / 「下次预计检查」/「打开日志文件」存在。

## 7. 里程碑

| 里程碑 | 范围 | 依赖 |
|--------|------|------|
| **M12** | 订阅触发机制（daily/interval）+ 检查可观测性（页内记录 + 落盘日志 + 下次预计） | M11 |

## 非目标（YAGNI）

- 每号独立的检查频率；日志轮转/分级；秒/分钟级间隔（最小 1 小时粒度）；检查记录的筛选/导出。
