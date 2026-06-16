# wx-kit v0.3.0 产品需求文档（迭代 PRD）

> 本文件是 **v0.3.0 迭代**的需求源头与验收依据，建立在 `docs/PRD.md`（v0.1.0）、`docs/PRD-v0.2.0.md` 之上。
> 「怎么做」见设计 spec `docs/superpowers/specs/2026-06-16-v0.3.0-list-polish-and-subscriptions-design.md`；
> 逐里程碑实现计划见 `docs/plans/`；状态/进度见 `ROADMAP.md`。
> 刻意写精不写厚——本迭代真正的增量是 **§4 验收标准**（逐条可勾）。

## 1. 一句话定义

把文库「列表」视图做顺手（列宽可调 + 表头排序），并新增**类 RSS 的公众号订阅**——让按公众号下载从「每次手动触发」升级为「订阅后周期检查、按需提示或自动下载」。

## 2. 目标与非目标

### 2.1 目标
- 列表视图：列宽用户可调且持久化；排序入口落到表头点击，符合「看哪列点哪列」的直觉。
- 订阅：用户可订阅公众号；app 运行期按配置的每日时刻检查新文章；发现新文章按配置「仅提示」或「自动下载」。

### 2.2 非目标（v0.3.0 明确不做）
- 真后台/常驻进程/系统级定时（app 必须开着才检查；关着时下次启动补检当天一次）。
- 列的显示隐藏、列拖拽重排、卡片视图布局变动。
- 每号独立的检查时刻或独立下载格式（全局统一配置）。
- 桌面系统通知弹窗、订阅导入导出（OPML 等）。
- 纯 URL 下载来的公众号（无 fakeid）进订阅列表——技术上无法轮询，故不展示。

## 3. 功能需求

### R1 · 列表视图列宽可调 + 表头排序（里程碑 M10）

**需求**：
- 文库「列表」视图列头之间可拖拽调整列宽，结果持久化（重开 app 保持）。「发布时间」默认宽度需能完整显示到分钟级时间串。
- 点击「标题 / 发布时间 / 下载时间」表头按该列排序，列头显 ↑/↓ 指示；同列再点翻转方向。
- 卡片视图没有表头，保留工具栏的排序下拉 + 方向按钮；列表视图不再显示工具栏排序入口（两入口共享同一排序状态）。

**存储影响**：`settings.json` 新增 `listColumnWidths`（`{ account, publish, download }` 像素宽，缺省回退默认值）。

### R2 · 公众号订阅（里程碑 M11）

**需求**：
- 导航新增「订阅」项，位于「下载」与「文库」之间。
- 订阅页列出**有 fakeid** 的公众号 = 来自「按公众号抓取」历史 ∪ 用户搜号添加；按 fakeid 去重。每个号可订阅/取消订阅。从历史派生的默认未订阅；搜号主动添加的默认已订阅。
- 「设置」页统一配置三项：
  - `subscriptionAutoCheck`（默认关，opt-in）；
  - `subscriptionCheckTime`（每日检查时刻，默认 `09:00`）；
  - `subscriptionNewArticleAction`（`notify` 仅提示 / `download` 自动下载，默认 `notify`）。
- 检查行为：开启自动检查后，app 运行期到达配置时刻触发；**app 启动时若当天时刻已过且当天未检查，补检一次**。订阅页提供「检查更新」手动触发。
- 检查**只列表不下载**；账号间串行 + 随机延迟，命中频控复用退避；单号失败隔离不连累其他号。
- 「新」的判定：文章 `createTime > watermark`。订阅那一刻水位设为该号当前最新文章时间（不把存量当新文章）；每次检查后水位推进到本次最新。
- 发现新文章后：`notify` 则存待处理 + 导航「订阅」项显示新文章总数角标、订阅页可逐号「下载 / 忽略」；`download` 则按配置格式走既有抓取管线下载入库（结果照常进下载历史）。
- session 过期**不静默失败**：订阅页显示登录引导（复用 `LoginGate`），调度暂停并明示「订阅检查需重新登录」。

**存储影响**：库根下新增 `subscriptions.json`（与 `library.json`/`history.json` 同级），按 fakeid 存订阅态、水位、上次检查时间、待处理新文章 refs。`settings.json` 增上述三项。

### R3 · 订阅触发机制升级 + 检查可观测性（里程碑 M12）

设计依据：`docs/superpowers/specs/2026-06-16-m12-subscription-schedule-and-observability-design.md`。

**需求**：
- **触发机制两种模式二选一**：「每天某时刻」（沿用 `subscriptionCheckTime`）或「每隔 N 小时」（新增 `subscriptionIntervalHours`，网格锚定每天 0 点：N=6 → 0/6/12/18 点）。`subscriptionScheduleMode` 默认 `daily`，不改老用户行为。两模式都支持启动补检。
- **检查可观测性**：每次检查（自动/手动）留痕——
  - 订阅页「检查记录」区：倒序最近 ~10 条（时间 · 自动/手动 · 查 N 号 · 新 M 篇 · 失败 K）；
  - 落盘日志 `userData/subscriptions-check.log`（人类可读、全量追加），订阅页「打开日志文件」可达；
  - 订阅页「下次预计检查」时间（按当前模式算；未开自动检查则明示）。

**存储影响**：`settings.json` 增 `subscriptionScheduleMode`、`subscriptionIntervalHours`；`subscriptions.json` 增 `checkLog`（留最近 50 条）；新增 `userData/subscriptions-check.log`。

## 4. 验收标准

### R1 / M10（✅ 已验，2026-06-16）
- [x] 列表视图列头可拖拽改宽，松手后保持；重启 app 后仍为上次宽度（持久化生效）。
- [x] 「发布时间」列默认宽度足以完整显示分钟级时间串（默认 150px）。
- [x] 点列头（标题/发布/下载）即按该列排序并显 ↑/↓；同列再点翻转方向。
- [x] 卡片视图保留工具栏排序入口；列表视图工具栏不再显示该入口。
- [x] `npm test`（126）/ `tsc` / `lint` 全绿；e2e 含「表头排序 desc/asc」「拖手柄 `--lcols` 变化」断言通过、零 console/page 错误。

### R2 / M11（✅ 已验，2026-06-16）
- [x] 导航出现「订阅」项，位于「下载」与「文库」之间。（e2e 断言）
- [x] 订阅页列出有 fakeid 的公众号（按公众号抓取历史 + 搜号添加）；纯 URL 下载来的号**不出现**。（`accountsFromHistory` 只取 account-kind，单测）
- [x] 每个号可订阅/取消订阅；搜号可添加新号（默认订阅、水位设为当前最新）。（store 单测 + `establishWatermark` 接线）
- [x] 设置页有三项：自动检查开关（默认关）、每日检查时刻（默认 09:00）、新文章处理（默认仅提示）。（settings 单测 + e2e 控件存在）
- [x] 开启自动检查后：运行期到达配置时刻触发检查；启动时当天时刻已过且未检查则补检一次。（`shouldCheckNow` 单测覆盖各分支 + scheduler `start()` 立即 tick）
- [x] 检查只列表不下载；发现 `createTime > watermark` 的文章按配置「仅提示（角标 + 逐号下载/忽略）」或「自动下载入库」。（`checkSubscriptions` 单测 + `runSubscriptionCheck` action 分支）
- [x] session 过期时不静默失败，订阅页显示登录引导、调度暂停并明示。（`checkSubscriptions` auth-abort 单测 + `subsAuthExpired`/Alert 接线）
- [x] 手动「检查更新」可即时触发，含进度/退避反馈。（`subscriptions:checkNow` + 页面按钮 e2e 存在）
- [x] core 层 `subscriptions` / `check-subscriptions` / `subscription-schedule` 单测覆盖（含新检测、水位推进、单号失败隔离、调度时机与启动补检）；订阅页本地 e2e 通过、零 console/page 错误。（17 条新单测 + e2e 全绿）

> 说明：自动检查的「真实壁钟到点触发 → 自动下载」整链由各构成逻辑单测保证（`shouldCheckNow` + `checkSubscriptions` + `runSubscriptionCheck`），e2e 无法等真实 09:00，故未做整链实时触发断言；构成逻辑均已覆盖。

### R3 / M12（✅ 已验，2026-06-16）
- [x] 设置可选「每天某时刻」或「每隔 N 小时」；默认 `daily`，老用户行为不变。（Segmented 切换 + 默认值单测）
- [x] interval 模式网格锚定每天 0 点（N=6 → 0/6/12/18 点），两模式均支持启动补检。（`lastScheduledInstant`/`shouldCheckNow` 单测各分支；scheduler tick 传 config）
- [x] 订阅页「检查记录」区倒序列最近 ~10 条（时间/自动手动/号数/新文章数/失败数）。（`appendCheckLog` 留 50 倒序单测 + 页面 slice(0,10)）
- [x] 落盘日志 `userData/subscriptions-check.log` 全量追加，订阅页「打开日志文件」可达。（`logCheck` 追加 + `subscriptions:openLog`）
- [x] 订阅页显示「下次预计检查」时间（未开自动检查则明示）。（`nextScheduledInstant` 单测 + list 返 nextCheckAt）
- [x] `checkLog` 仅留最近 50 条；`formatCheckLogLine` 格式单测；写盘失败不阻断检查主流程。（单测 + `logCheck` try/catch）
- [x] core 纯逻辑 TDD + 订阅/设置页 e2e（模式切换、检查记录/下次预计/打开日志存在）通过、零 console 错误。（12 条新单测 + e2e 全绿）

> 说明：定时「真实壁钟到点自动触发」整链仍由构成逻辑单测保证（`shouldCheckNow` + `runSubscriptionCheck('auto')`），e2e 等不到真实网格点；构成逻辑与留痕均已覆盖。

## 5. 里程碑拆分

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M10** | 列表视图优化：列宽可调 + 表头排序（R1） | ✅ 已合入 main |
| **M11** | 公众号订阅：订阅页 + 定时轮询 + 新文章检测 + 设置项 + 提示/自动下载（R2） | ✅ 已合入 main |
| **M12** | 订阅触发机制（daily/interval）+ 检查可观测性（页内记录 + 落盘日志 + 下次预计）（R3） | ✅ 已合入 main |

两里程碑相互独立，无强制先后；已先做 M10（小、低风险），再做 M11（大）。
