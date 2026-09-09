# M58（v0.10.6）实现计划：订阅行内「本轮检查文章列表」

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/PRD-v0.10.6.md` R1——订阅行内逐篇文章列表（检查后显示、持久、可单篇下载、点标题跳阅读器）。

**Architecture:** 列表数据源 = 检查记录 `downloadDetail`（扩展为**全号落条目**：提示策略落 `pending`、无新文章落空 `items`）；状态五态（新增 `pending`）；下载完成后回填最近一条记录的状态与 `articleId`；行内 UI 从 `newRefs` 渲染切换为检查记录派生，勾选批量与全局按钮不动。

**Tech Stack:** Electron 主进程 IPC + core 纯函数 + React/Antd v6 + vitest + Playwright e2e。

**Spec:** `docs/PRD-v0.10.6.md`（§3 需求、§4 交互约定、§6 验收）

## Global Constraints

- 渲染层只 import 零 node 依赖的纯 core 模块（`import type` 除外；M56 白屏红线）。
- 纯逻辑 TDD；注释中文；commit message 写临时文件 `git commit -F`。
- Antd v6：两汉字按钮文本自动插空格，e2e 选择器优先 `data-testid`。
- 下载动作必须走全局网关（串行/守卫），不得绕过（复用 `subscriptionsDownloadNew`）。
- CLI 输出结构不动（`recentLog` 新增空 `items` 条目对消费者按 `items` 过滤兼容）。

## 现状核实表（2026-09-09 对源码核实）

| 落点 | 现状 | 差异 |
|---|---|---|
| `src/core/subscriptions.ts:32-52` | `DownloadItemLog{title,status(4态),error?}`；`CheckLogEntry.downloadDetail` 仅 download 策略写 | +`pending` 态、`articleId?/url?/refId?`；全号落条目 |
| `src/core/subscriptions.ts:71-89` | `toDownloadItemLogs(items, refs)` 按 4 态映射；`toAccountDownloadLog` 组装 | +回填 `articleId/url/refId` |
| `electron/services/subscription-check.ts:99-136` | `newRefs.length===0` 早 continue（不进 downloadLogs）；提示策略 `addNewRefs` 后不落明细 | 三分支全落条目；新 deps `findArticleId?` |
| `electron/ipc.ts:370`、`src/cli/index.ts:429` | `isRefDownloaded: downloadedUrls.has(sourceKey)`（boolean） | 新增 `findArticleId?` 装配（Library 按 sourceUrl 查 id），isRefDownloaded 不动 |
| `electron/ipc.ts` `subscriptions:downloadNew` | 批量下载（ids 子集），完成后不回填检查记录 | handler 末尾回填 `checkLog[0]` 对应 items |
| `src/core/subscriptions.ts:246-249` | `getCheckLog/appendCheckLog` | 新增 `mutateLatestCheckDetail(fakeid, fn)`（写锁内原子更新最新记录） |
| `src/renderer/subscription-view.ts:13-34` | `latestResultByAccount(checkLog)` + `summaryPhrase` | 新增 `latestItemsForAccount`；摘要适配全 pending |
| `src/renderer/pages/Subscriptions.tsx:219-241` | `pendingPanel` 渲染 `newRefs`（勾选+标题开原文） | 数据源换检查记录派生；Tag/按钮/点击分派 |
| 阅读器 | 路由 `/reader/:id`（`Library.tsx:123` 先例） | `nav('/reader/<articleId>')` |

## 任务

### Task 1: 数据层——types 扩展 + 检查记录更新 API

**Files:**
- Modify: `src/core/subscriptions.ts`（types、`toDownloadItemLogs`、新 `mutateLatestCheckDetail`）
- Test: `tests/core/subscriptions.test.ts`（若无则按现有同名测试文件位置追加）

**Interfaces:**
- Produces: `DownloadItemLog{ title, status: 'downloaded'|'exists'|'failed'|'unavailable'|'pending', error?, articleId?, url?, refId? }`；`Subscriptions.mutateLatestCheckDetail(fakeid, fn: (items: DownloadItemLog[]) => DownloadItemLog[]): Promise<boolean>`（最新含该号条目的记录原子更新，返回是否命中）。

- [ ] **Step 1: 失败测试**——`pending` 合法态；`toDownloadItemLogs` 透传 `url/refId/articleId` 映射；`mutateLatestCheckDetail` 更新最新含该号条目、无该号时返回 false、历史条目不动。

```ts
// types 扩展后合法
const item: DownloadItemLog = { title: '待处理', status: 'pending', url: 'https://mp.weixin.qq.com/s/a', refId: '2247486019_1' }

// mutateLatestCheckDetail：checkLog 两条，最新含 A 号、更旧含 B 号
// mutate('A') 只改最新条目；mutate('B') 落在更旧条目（B 只在旧条目出现）
```

- [ ] **Step 2: 跑测试确认失败**（`npx vitest run tests/core/subscriptions.test.ts`）。
- [ ] **Step 3: 实现**——`status` union 加 `'pending'`；`DownloadItemLog` 加 `articleId?/url?/refId?`；`toDownloadItemLogs` 增加 `extra?: (item) => Partial<DownloadItemLog>` 或直接在构造时合并 refs 提供的 `url/refId`（以 refs 元素携带为准）；`mutateLatestCheckDetail` 在 `mutate`（既有写锁机制）内实现。
- [ ] **Step 4: 跑测试通过**；`npx tsc --noEmit -p tsconfig.json`。
- [ ] **Step 5: Commit**——`feat(core): pending status and check-detail mutation API (M58 T1)`。

### Task 2: 检查落盘全号明细 + articleId 回填

**Files:**
- Modify: `electron/services/subscription-check.ts`（三分支落条目、deps 加 `findArticleId?`）
- Modify: `electron/ipc.ts:370` 附近与 `src/cli/index.ts:429` 附近（装配 `findArticleId`）
- Test: `tests/electron/subscription-check.test.ts`

**Interfaces:**
- Consumes: T1 的 types。
- Produces: `RunCheckDeps.findArticleId?: (ref: ArticleRef) => Promise<string | null>`；`downloadLogs` 每号一条（空 `items` = 查过无新文章）。

- [ ] **Step 1: 失败测试**——三断言：① 提示策略检查后 checkLog 最新条目 `downloadDetail` 含该号且 items 全 `pending`（带 `url/refId`）；② 无新文章的号落 `{items: []}` 条目；③ `findArticleId` 提供时 downloaded/exists 条目带 `articleId`。
- [ ] **Step 2: 确认失败**。
- [ ] **Step 3: 实现**——`subscription-check.ts`：
  - `newRefs.length === 0` 分支：`downloadLogs.push({ fakeid, nickname, items: [] })` 后 continue；
  - 提示策略 `addNewRefs` 后：`downloadLogs.push({ fakeid, nickname, items: newRefs.map((r) => ({ title: r.title || '(无标题)', status: 'pending' as const, url: r.url, refId: refId(r) })) })`；
  - download 策略：`toAccountDownloadLog(...)` 后按 `summary.items`/`newRefs` 的 url 匹配回填 `url/refId`，`findArticleId` 对 `downloaded/exists` 项查 `articleId`（Promise.all）。
  - 装配点：`findArticleId: async (ref) => (await new Library(root).list()).find((m) => sourceUrlKey(m.sourceUrl) === sourceUrlKey(ref.url))?.id ?? null`（提取小函数避免两处重复；CLI 同）。
- [ ] **Step 4: 通过 + 全量三件套**。
- [ ] **Step 5: Commit**——`feat(subscriptions): per-account check detail with pending state (M58 T2)`。

### Task 3: 下载完成后回填最近检查记录

**Files:**
- Modify: `electron/ipc.ts`（`subscriptions:downloadNew` handler 末尾）
- Test: `tests/electron/subscription-check.test.ts`（或 handler 级测试所在文件）

**Interfaces:**
- Consumes: T1 `mutateLatestCheckDetail`、`toDownloadItemLogs`。

- [ ] **Step 1: 失败测试**——先跑一次检查（提示策略，落 pending 明细），再调下载（同号单 id），断言 `checkLog` 最新条目中该 item `status` 变为 `downloaded` 且带 `articleId`；无对应 url 的 item 不受影响。handler 测试不好直连时，把回填逻辑抽为 core 纯函数 `mergeCheckDetailItems(existing, fresh: DownloadItemLog[]): DownloadItemLog[]`（按 url 匹配覆盖，旧条目保留）对它单测，handler 一行调用。
- [ ] **Step 2: 确认失败**。
- [ ] **Step 3: 实现**——`mergeCheckDetailItems` 进 `src/core/subscription-batch.ts`；handler 在 `summary` 返回后：

```ts
const items = toDownloadItemLogs(summary, picked)
await subs.mutateLatestCheckDetail(fakeid, (cur) => mergeCheckDetailItems(cur, items))
```

  （`toDownloadItemLogs` 从 core/subscriptions re-export 处 import；`picked` 是本次下载的 refs。）
- [ ] **Step 4: 通过 + 三件套**。
- [ ] **Step 5: Commit**——`feat(subscriptions): write back download outcomes to the latest check (M58 T3)`。

### Task 4: 行内 UI 重构

**Files:**
- Modify: `src/renderer/subscription-view.ts`（`latestItemsForAccount`、`summaryPhrase` 适配）
- Modify: `src/renderer/pages/Subscriptions.tsx`（`pendingPanel` 重构）
- Test: `tests/renderer/subscription-view.test.ts`

**Interfaces:**
- Consumes: T1/T2 的 item 形态。
- Produces: `latestItemsForAccount(checkLog, fakeid): DownloadItemLog | null`（最近一条含该号条目，无则 null）。

- [ ] **Step 1: 失败测试**——`latestItemsForAccount`：最新记录含 A（空 items）→ 返回该空条目；A 不在最新记录但在更旧 → 返回更旧；两处都没有 → null。`summaryPhrase` 全 pending：`发现 N 篇，待下载`。
- [ ] **Step 2: 确认失败**。
- [ ] **Step 3: 实现**——
  - `subscription-view.ts`：`latestItemsForAccount = (log, fakeid) => log.find((e) => e.downloadDetail?.some((d) => d.fakeid === fakeid))?.downloadDetail?.find((d) => d.fakeid === fakeid) ?? null`；`summaryPhrase` 全 `pending` 时返回 `发现 N 篇，待下载`。
  - `Subscriptions.tsx` `pendingPanel`：数据源 `latestItemsForAccount(checkLog, fakeid)`（`checkLog` 已在 state，M56）；`items` 为空或 null → 不渲染（现状语义）；每行：Checkbox（value 用 `item.refId`，勾选批量仍传 newRefs 的 refId——pending 条目 `refId` 与 newRefs 的 `refId(r)` 相同）/ 标题（`articleId ? nav('/reader/'+articleId) : api.openExternal(item.url)`）/ 状态 Tag（五态五色）/ `pending` 时 `<a data-testid="subs-item-download">下载</a>` 调 `api.subscriptionsDownloadNew(fakeid, [item.refId])`（busy 禁用）。`data-testid`：`subs-pending-item`（沿用）、`subs-item-status`、`subs-item-download`。
  - 展开条件从 `a.newRefs.length` 改为「列表 items 非空或 newRefs 非空」。
- [ ] **Step 4: 通过 + 三件套**。
- [ ] **Step 5: Commit**——`feat(subscriptions): inline per-article list with status and one-click download (M58 T4)`。

### Task 5: e2e 断言 + 全量验证 + 文档同步

**Files:**
- Modify: `tests/e2e/gui.e2e.mjs`（订阅段追加）
- Modify: `docs/releases/v0.10.6.md`、`README.md`、`ROADMAP.md`、`docs/devlog/wx-kit-vibe-coding.md`、`agent/wx-kit-skill/references/commands.md`（`recentLog` 空 `items` 条目说明）

**Interfaces:** 无。

- [ ] **Step 1: e2e 断言**——订阅段（提示策略 mock 下）：行内检查后展开 → `subs-pending-item` 出现、`subs-item-status` 文本「未下载」、点 `subs-item-download` → 等待状态 Tag 变「已下载」（mock 下载成功）。加 `reader` 跳转断言（有 `articleId` 的条目点标题 → `win.waitForURL(/reader/)`）。自动下载策略分支已有 M56 断言回归覆盖。
- [ ] **Step 2: 跑 e2e**——`npm run test:e2e`，**必须读输出确认每条 ✓**（exit 0 会假绿）。
- [ ] **Step 3: 全量三件套**。
- [ ] **Step 4: 文档同步**——按 v0.10.5 惯例全套（PRD 已有）；skill 补 `recentLog.downloadDetail` 现含空 `items` 条目（查「某号下载了什么」按 `items.length` 过滤）；README 亮点段替换；ROADMAP 状态/发布史；devlog §55。
- [ ] **Step 5: Commit**——`test(e2e): pin M58 inline list interactions; docs closeout (M58 T5)`。

## Self-Review 记录

- **Spec 覆盖**：PRD §6 八条 → T2（落盘/回填）、T3（回填）、T4（列表/Tag/按钮/点击/摘要）、T5（持久/隔离/全量）。R1 全覆盖。
- **类型一致**：`DownloadItemLog` 扩展字段（`pending/articleId/url/refId`）在 T1 定义、T2/T3/T4 消费，签名一致；`latestItemsForAccount` 返回条目对象（含 `items`）而非裸数组，测试与 UI 按 `.items` 取。
- **已知风险**：① 回填只作用 `checkLog[0]`（下载前又跑了新一轮检查则不回填，下次检查刷新——PRD 已注明边界）；② 全 pending 的 `summaryPhrase` 话术微调需同步 e2e 既有断言（M56 摘要断言的提示策略分支）——T4 实现时跑全量确认，若旧断言挂则按新话术迁移并在提交信息注明。
