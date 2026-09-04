# M56 · 订阅自动下载可感知与文库直达

> 需求契约见 `docs/PRD-v0.10.2.md`（§6 逐条验收）；分支 `feat/m56-subscription-visibility`。
> 本版只加可观测与入口，不改调度、水位、串行与请求保护语义。

## 现状核实（2026-09-04 写计划时已确认的代码事实）

| 事实 | 位置 |
|---|---|
| `CheckLogEntry` 只记 `newFound`/`failed`/`failures`，无任何下载字段 | `src/core/subscriptions.ts:25-33` |
| 自动下载编排：`runSubscriptionCheck` 的 `log` 落盘在下载循环之后；逐号 `downloaded` 有数，但 `DownloadSummary.items` 用完即弃，逐篇明细无处收集 | `electron/services/subscription-check.ts:104-125` |
| 手动「下载全部待处理」（`subscriptions:downloadAllNew`）**完全不落 checkLog** | `electron/ipc.ts:431-455` |
| `DownloadItemResult` 有 `ok/skipped/unavailable/title/error:{code,message}`——四状态映射原料齐；失败项标题缺省（可从 `ArticleRef.title` 按 url 补） | `src/core/types.ts:71`、`src/core/download-queue.ts:45-48` |
| 行内结果态是当次内存态；「去看看」仅在 `downloaded>0` 时出现、按 `nickname` 跳 | `src/renderer/pages/Subscriptions.tsx:230-239` |
| 文库按号筛选是**名称字面匹配**；`?account=` 一次性消费 | `src/renderer/library-view.ts:28`、`src/renderer/pages/Library.tsx:29-32` |
| CLI 无 `results` 子命令；`check-now` 输出逐号 `results[]`；**定时自动下载（GUI 进程）无任何 CLI 可查路径** | `src/cli/index.ts:400-434` |
| 测试布局：`tests/core/subscriptions.test.ts`、`tests/electron/subscription-check.test.ts`、`tests/renderer/library-view.test.ts`、`tests/cli/cli-contract.test.ts` | — |

## 设计

### 数据结构（`src/core/subscriptions.ts`）

```ts
/** 逐篇下载结果（M56）。四状态：刚下载 / 文库已有 / 真故障 / 读者不可见。 */
export interface DownloadItemLog {
  title: string
  status: 'downloaded' | 'exists' | 'failed' | 'unavailable'
  error?: string              // 仅 failed：失败原因（error.message）
}
export interface AccountDownloadLog { fakeid: string; nickname: string; items: DownloadItemLog[] }

export interface CheckLogEntry {
  time: number
  trigger: 'auto' | 'manual'
  accounts: number
  newFound: number
  failed: number
  failures?: CheckFailure[]
  note?: string
  /** M56：'check'=检查（可含自动下载交付）；'download'=纯交付（手动批量补下载）。缺省 'check'=旧数据兼容。 */
  kind?: 'check' | 'download'
  downloaded?: number                      // 刚下载篇数（不含 exists——不把「文库已有」伪装成「刚下载」）
  existed?: number                         // 文库已有篇数
  downloadDetail?: AccountDownloadLog[]    // 有下载动作才写
}
```

- 全部新字段可选：旧 `subscriptions.json` 读入零迁移，`formatCheckLogLine` 对旧条目输出不变。
- `appendCheckLog` 的 keep 50 容量不变（每条明细至多几十篇，体积可控）。

### 状态映射（纯函数，放 `src/core/subscriptions.ts` 供编排层复用）

```ts
/** DownloadItemResult → 下载日志条目。失败项标题缺省时从 refs 按 url 补（列表本来就给标题）。 */
export function toDownloadItemLogs(items: DownloadItemResult[], refs: { url: string; title: string }[]): AccountDownloadLog['items']
```

判定：`ok && !skipped → 'downloaded'`；`ok && skipped → 'exists'`；`!ok && unavailable → 'unavailable'`；其余 → `'failed'`（error 取 `item.error?.message`）。

### 落盘接入

1. **自动检查 + 自动下载**（`subscription-check.ts`）：perAccount 循环内把每次 `downloadRefs` 返回的
   `summary.items` 连同 refs 映射成 `AccountDownloadLog` 收集；循环后 `deps.log(...)` 扩展写入
   `kind:'check'` + `downloaded` + `existed` + `downloadDetail`。仅提示策略（无下载动作）不写这些字段。
2. **手动批量**（`ipc.ts` 的 `subscriptions:downloadAllNew`）：groups 循环同样收集明细，完成后
   `appendCheckLog({ time, trigger:'manual', kind:'download', accounts: groups.length, newFound: 0,
   failed: 0, downloaded, existed, downloadDetail })`。落盘失败不阻断下载结果返回（与 check-now 的
   log 容错一致）。
3. 行内单号下载（`subscriptions:downloadNew`）**不落记录**：它是单行即时操作，结果就地可见；
   全局批量与自动下载是「无人盯着」的链路，才需要留痕。——若验收时发现单行也需要，再议，不预造。

### GUI（`Subscriptions.tsx`）

- **行内摘要改为 checkLog 派生**（单一数据源）：`useMemo` 建 `fakeid → 该号最近一条含结果的记录`
  映射；检查/下载完成 → 落盘 → `emitSubsUpdated` → 状态重取 → 行内自动刷新。当次进度仍走内存态
  （bulkDl / checking），完成后由落盘数据接管，不再双源拼接。
- 摘要话术区分发现与交付：`发现 2 篇，已下载 2 篇` / `发现 1 篇，文库已有 1 篇` / `发现 0 篇`；
  标注触发方式（自动/手动）与时间。
- **明细弹窗**：`showFailures` 扩展为通用明细弹窗——`failures`（检查失败）与 `downloadDetail`
  （逐篇：标题 + 状态 Tag）分节展示；旧记录（两字段皆无）保持现有纯文本渲染。

### R2 文库入口

- 行 actions **常驻「查看文库」链接**（每号都有，不再仅 `downloaded>0`），跳
  `/library?account=<fakeid>`——参数从 nickname 换成 fakeid（身份）。
- `filterByAccount` 升级（`src/renderer/library-view.ts`）：入参既可能是身份（跳转）也可能是名称
  （文库页筛选下拉 `accountsOf` 仍给名称）。匹配顺序：`normalizeAccountKey(m.accountId) ===
  normalizeAccountKey(account)` 优先，不中再 `accountName(m) === account` 字面兜底。
  旧条目缺 `accountId` 时名称兜底覆盖。
- 文库页筛选态空结果（`account` 非空且筛选后 0 条）给专属提示「该公众号还没有已下载的文章」，
  不复用「文库为空」的全局空态。
- 清除筛选沿用既有筛选控件（`?account=` 一次性消费机制不变）。

### CLI（`src/cli/index.ts`）

- `subscription check-now`：输出 `results[]` 逐号加 `articles: DownloadItemLog[]`（`PerAccountResult`
  扩展，`outJson` 透传自动跟上）。
- `subscription list`：输出加 `recentLog`（`subs.getCheckLog()` 前 5 条，全量含新字段）。
- 两者 stdout 纯 JSON 契约不变；`subscription` 已在 `CLI_COMMANDS` 白名单，无分流风险。

### 文档

`agent/wx-kit-skill/`（SKILL.md 速查 + references/commands.md 的 list/check-now 输出说明 +
recipes.md 若有订阅范例）、README 若涉及订阅能力描述、ROADMAP / devlog 随实现同批。

## 实施步骤

### T1 · 数据层：类型扩展 + 状态映射（TDD）

涉及 `src/core/subscriptions.ts`；测试 `tests/core/subscriptions.test.ts`。

- [ ] 先写测试：`toDownloadItemLogs` 四状态映射各一例；失败项标题从 refs 补全；error 透传。
- [ ] 先写测试：旧格式 checkLog 条目（无新字段）读入与 `formatCheckLogLine` 输出不变；新条目
      `formatCheckLogLine` 输出含 `downloaded=N existed=N`。
- [ ] 实现类型 + 纯函数，测试通过。

### T2 · 落盘接入：自动下载与手动批量（TDD）

涉及 `electron/services/subscription-check.ts`、`electron/ipc.ts`；测试
`tests/electron/subscription-check.test.ts`（注入 downloadRefs 返回带 items 的 summary 断言 entry）。

- [ ] 先写测试：download 策略下 entry 含 `kind:'check'`、`downloaded`/`existed` 计数与逐号明细；
      仅提示策略 entry 无这些字段；下载失败项标 `failed` 且留在待处理的语义不变。
- [ ] 先写测试：`trigger:'manual'` + `fakeids` 子集（行内单号检查）在 download 策略下同样落明细——
      三条触发路径（行内/检查全部/定时）共用本编排函数，明细收集不得假设 trigger。
- [ ] 先写测试：`kind:'download'` 记录（手动批量）的形状——`newFound:0`、明细可区分 trigger。
- [ ] 实现 `runSubscriptionCheck` 明细收集与 entry 扩展；实现 `downloadAllNew` 落盘（落盘失败
      try/catch 不阻断返回）。

### T3 · GUI：行内摘要 + 明细弹窗

涉及 `src/renderer/pages/Subscriptions.tsx`；逻辑尽量进 `src/renderer/` 可测纯层。

- [ ] 行内摘要 checkLog 派生的 `useMemo` 映射函数写成可测纯函数（放 renderer 层，测试落在
      `tests/renderer/`）。
- [ ] 明细弹窗改造：failures + downloadDetail 分节；旧记录渲染不变。
- [ ] `npm run test:e2e`：seed 一条含 `downloadDetail` 的 checkLog 到隔离 userData，断言行内
      摘要与弹窗渲染（fixture 驱动，不碰网络）。

### T4 · R2 文库入口

涉及 `src/renderer/pages/Subscriptions.tsx`、`src/renderer/library-view.ts`、`src/renderer/pages/Library.tsx`；
测试 `tests/renderer/library-view.test.ts`。

- [ ] 先写测试：`filterByAccount` 身份优先（`MP_WXS_` vs base64 两种历史形态归一后等价）、名称兜底、
      旧条目缺 `accountId` 走名称。
- [ ] 行 actions 常驻「查看文库」；跳 `/library?account=<fakeid>`。
- [ ] 文库页筛选态空结果专属提示。

### T5 · CLI + skill 同步

涉及 `src/cli/index.ts`；测试 `tests/cli/cli-contract.test.ts`。

- [ ] 先写测试：`list` 输出含 `recentLog`；`check-now` 的 `results[].articles` 透传明细。
- [ ] 实现；`agent/wx-kit-skill`（SKILL.md + references/commands.md + recipes.md 订阅范例）同批刷新。

### T6 · 文档与验收（含 R3 验收遗留）

- [ ] `npm test` / `npm run lint` / `npx tsc --noEmit -p tsconfig.json` / `npm run build` /
      `npm run test:e2e` 全绿。
- [ ] 真实链路验收：真实文章 URL 下载（多格式 + 阅读器）；真实 `cover` 增量检查（首检一次 +
      增量不重复 + 自动下载记录可查）；GUI 真机走一遍「检查 → 自动下载 → 行内摘要/弹窗 → 查看文库」。
- [ ] `docs/PRD-v0.10.1.md` §6 三条未勾项逐条补勾；`docs/PRD-v0.10.2.md` §6 勾选。
- [ ] ROADMAP（当前状态 / M56 行 / PRD 索引）、devlog 增补；发版走标准流程（feat → main → tag →
      GitHub Release + brew tap，README 同批刷新）。
