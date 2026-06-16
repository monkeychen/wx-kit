# wx-kit — 路线图与状态

> 项目进度的「状态板」。`AGENTS.md` 是稳定的宪法（决策/不变量/陷阱），刻意不放易变的状态——
> 状态看这里。更细的真相以 `git log` 与 `docs/plans/` 的实现计划为准。

## 里程碑

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M1** | 工程骨架 + UI 无关核心层 + CLI `wx-kit download`（cover/md/html/pdf/meta 五格式）+ 文章库索引 | ✅ 已合入 main |
| **M2** | GUI：应用壳 + URL 下载页（实时进度）+ 文章库（搜索/删除/在文件夹显示）+ 内置阅读器（md/html）+ 设置；IPC 桥；`wxfile://` 协议；GUI 端到端测试 | ✅ 已合入 main |
| **M3（CLI 切片）** | 扫码登录 mp.weixin.qq.com 后台 + 公众号批量爬取（按数量/日期范围）；CLI `login`/`auth-status`/`search`/`crawl`/`library list` | ✅ 已合入 main |
| **M3.5** | GUI 批量页（整页登录引导 → 搜号 → 选范围/格式 → 实时逐篇进度 + 取消/重试） | ✅ 已合入 main |
| **M4** | electron-builder 打包：未签名 mac(dmg arm64+x64) + win(nsis x64)，品牌「宝盒」图标 | ✅ 已合入 main |

## 实现计划（docs/plans/）
各里程碑的详细实现计划放在 `docs/plans/`，索引在此维护：
- **M1** — `docs/plans/2026-06-06-m1-core-and-url-download.md`
- **M2** — `docs/plans/2026-06-06-m2-gui.md`
- **M3** — `docs/plans/2026-06-07-m3-login-and-crawl.md`（设计依据 `docs/superpowers/specs/2026-06-07-m3-login-crawl-design.md`）
- **M3.5** — `docs/plans/2026-06-07-m3.5-batch-crawl-gui.md`（设计依据 `docs/superpowers/specs/2026-06-07-m3.5-batch-crawl-gui-design.md`）
- **M4** — `docs/plans/2026-06-07-m4-packaging.md`（设计依据 `docs/superpowers/specs/2026-06-07-m4-packaging-design.md`）
- **M5** — `docs/plans/2026-06-08-m5-ia-restructure.md`（v0.2.0 首个里程碑）
- **M6** — `docs/plans/2026-06-08-m6-download-closure-history.md`（下载闭环 + 历史）
- **M7** — `docs/plans/2026-06-08-m7-feedback-guidance.md`（频控可见 + 失败引导）
- **M8** — `docs/plans/2026-06-08-m8-pdf-page-break.md`（PDF 防跨页切断）
- **M9** — `docs/plans/2026-06-08-m9-library-organization.md`（文库组织 + 卡片/列表视图）
- **M10** — `docs/plans/2026-06-16-m10-list-view-polish.md`（列表视图列宽可调 + 表头排序；v0.3.0 首个里程碑，设计依据 `docs/superpowers/specs/2026-06-16-v0.3.0-list-polish-and-subscriptions-design.md`）✅ 已合入 main
- **M11** — `docs/plans/2026-06-16-m11-subscriptions.md`（公众号订阅：订阅页 + 定时轮询 + 新文章检测 + 设置项 + 提示/自动下载；设计依据同上 spec，验收 `docs/PRD-v0.3.0.md` §4 R2）✅ 已合入 main
- **M12** — `docs/plans/2026-06-16-m12-subscription-schedule-and-observability.md`（订阅触发机制 daily/interval + 检查可观测性：页内记录 + 落盘日志 + 下次预计；设计依据同上 spec，验收 `docs/PRD-v0.3.0.md` §4 R3）✅ 已合入 main

## 当前状态
- **v0.3.0 迭代（M10+M11+M12 已合入 main，功能完成待发版）**：
  - **M10 列表视图优化**——文库「列表」视图列宽可拖拽调整（持久化进 `settings.json` 的 `listColumnWidths`）、排序移到表头点击（标题/发布/下载，↑↓ 指示，同列再点翻向），卡片视图保留工具栏排序入口。纯逻辑抽 `src/renderer/list-columns.ts` TDD；拖拽/点表头本地 e2e 验证。
  - **M11 公众号订阅**——新增「订阅」页（导航在下载与文库之间），列出有 fakeid 的公众号（按公众号抓取历史 ∪ 搜号添加，URL-only 不入列），可订阅/取消订阅 + 搜号添加；运行期定时检查（opt-in，`subscriptionAutoCheck` + 每日 `subscriptionCheckTime`，启动补检），发现新文章按 `subscriptionNewArticleAction` 仅提示（角标 + 逐号下载/忽略）或自动下载。core 三件套 `subscriptions` / `subscription-schedule` / `check-subscriptions` 全 TDD（17 条新单测）；主进程 scheduler + IPC 编排，session 过期不静默（页面登录引导）。验收 `docs/PRD-v0.3.0.md` §4 R2 逐条已勾。
  - **M12 触发机制升级 + 检查可观测性**——定时检查支持两种模式：每天某时刻 / 每隔 N 小时（interval 网格锚定每天 0 点，两模式均启动补检），`subscription-schedule` 抽象出 `lastScheduledInstant`/`nextScheduledInstant`/`shouldCheckNow`（纯函数，13 条单测覆盖 daily×interval 各分支）。检查可观测性三处呈现：订阅页「检查记录」（倒序最近 10，由 `subscriptions.json` 的 `checkLog` 留 50 驱动）、落盘日志 `userData/subscriptions-check.log`（全量追加 + 「打开日志文件」）、「下次预计检查」时间。每次检查（auto/manual）留痕，写盘失败不阻断主流程。core 12 条新单测、e2e 全绿（含 daily⇄interval 切换、可观测性元素）。
  - **UI 一致性打磨（M12 后）**——四个导航页统一成满宽内容栏（去掉仅下载/设置套的 `.page-narrow` 居中窄栏），切页面不再跳宽窄。真实 session 测量四个页面 `.fade-in` 宽度一致验证。
- **最新发布：v0.2.1（2026-06-09，安全补丁）** —— 功能同 v0.2.0，升 electron 31→42 + electron-builder 24→26 + vite 6 + vitest 3，Dependabot 28 项全部 fixed 归零。tag + GitHub Release（mac dmg arm64/x64 + win nsis exe）已发。详见下方「v0.2.0 迭代」段。
- M9 文库组织：文库从「只能搜+删」升级为可治理的藏馆——排序（下载/发布时间/标题，升降）、按公众号筛选+可折叠分组、批量选择+批量删除；并新增**卡片⇄列表**视图切换（列表为访达式紧凑行）。交互：默认分组+卡片；单击=选中、双击=阅读、行尾/卡片 hover 常驻「阅读/文件夹/删除」。排序/分组/筛选是纯逻辑（`src/renderer/library-view.ts`，TDD）；批量删除走 `library:removeMany`（联动历史标记已删除）。真实 session 截图（5 公众号 15 篇）验证三态。
- M8 PDF 保真：导出 PDF 时图片/表格/代码块/引用不再被 A4 页边界拦腰切断——在 `buildHtml` 的内联样式注入 `@media print { break-inside: avoid }`，只作用于打印态、屏幕阅读器零影响。对照验证（同一会跨页的代码块，有/无规则出 PDF）：无规则版被切到第 17 行、有规则版整块下移到次页完整；真实图文长文 9 页 PDF 图片完整无切断。
- M7 反馈引导：公众号列表阶段命中频控时，朱砂退避横幅可见（「约 N 秒后重试 · 第 k 次」客户端倒数），不再像卡死；所有下载失败经 `explainError` 归一为「人话标题 + 下一步建议」，原始报错折叠在 tooltip。R3「完成/取消回到配置」经端到端验证为既有流程已满足（`await mpCrawl` 完成即清空进度、配置卡自动重现、状态不丢），未加冗余按钮。
- M7 取消体验打磨（安哥追加）：抓取「取消」改 Popconfirm 二次确认；因取消未下载的文章不再蒸发——补登记为 `cancelled` 进历史，以「未下载」徽章列出并提供单篇「下载」补下（真实 session 端到端截图验证）。
- M4 打包已通：未签名 mac dmg(arm64+x64) + win nsis x64 安装包，品牌「宝盒」图标。打包后真实启动 .app 验证通过（undici external 站得住）。win-from-mac 在本机也跑通，未启用 CI 兜底。
- M3.5 批量爬取已有 GUI：整页登录引导 → 搜号 → 选范围/格式 → 实时逐篇进度（取消=停后续保留已下，失败可单篇重试）。缓存 session 有效期内免扫码，真实账号 GUI 端到端验证通过。
- M3 CLI 切片：扫码登录持久化 session、`appmsg` 列文章、复用 M1 管线落盘。
- M2 GUI 为「暖色编辑杂志风」：刊头横导航、封面卡片书架、友好格式选择、editorial 阅读版面。
- 测试规模不在此写死数字——跑 `npm test`（单测）与 `npm run test:e2e`（GUI 端到端）看当前真实结果。

## 下一步
v0.1.0（M1–M4 第一阶段 + 分发）、v0.2.0（M5–M9 信息架构/下载闭环/文库组织）均已发布，v0.2.1 安全补丁清掉全部 Dependabot。**v0.3.0（M10–M12 列表优化 + 公众号订阅 + 订阅触发/可观测性）已全部合入 main、功能完成待发版**（验收 `docs/PRD-v0.3.0.md` §4 全勾）。下一步可议 v0.3.0 出包发版（bump 0.3.0 + tag + Release，走 `docs/AGENTS.md` 发版规约）。其余方向待定（mac 签名公证、应用内更新、其他形式内容保真等见「非目标」，需要时再单议）。

候选待议（未排期，需要时单议）：
- **Windows CLI stdout 正解** —— 当前打包后 win 是 GUI 子系统程序，CLI 模式 stdout 不回贴调用控制台，文档里只给了「重定向到文件」的绕法（见 README「安装包后的 CLI 用法」、AGENTS.md 陷阱清单）。真要让 Windows agent 集成丝滑，正解是打包时给 win 出一个 console 子系统入口（或 `wx-kit-cli.exe` wrapper 转发到主程序）。要动打包配置，等真要铺 Windows agent 场景再做。

## v0.2.0 迭代（已发布，2026-06-09）
需求见 `docs/PRD-v0.2.0.md`。主题：把下载闭环做扎实、信息架构理顺——「下得放心、找得到、看得见」。
> R1–R7 全部落地：信息架构重构（M5）、下载闭环+历史（M6）、频控可见+失败引导（M7）、PDF 防跨页（M8）、文库组织+卡片/列表视图（M9）。发布说明 `docs/releases/v0.2.0.md`。
> **v0.2.1（已发布，2026-06-09，安全补丁）**：功能同 v0.2.0，升 electron 31→42 + electron-builder 24→26 + vite 6 + vitest 3，**Dependabot 28 项全部 fixed、归零**。tag `v0.2.1` + GitHub Release（含 `wx-kit-0.2.1-arm64.dmg` / `wx-kit-0.2.1.dmg` / `wx-kit Setup 0.2.1.exe`）已发布。发布说明 `docs/releases/v0.2.1.md`；依赖审计与网络坑（npmmirror 镜像 + no_proxy、gh 直连）`docs/plans/2026-06-09-deps-audit.md`。
> v0.1.0 收尾期已随手修复：md 代码块丢失 / 发布时间解析 / fetch 硬超时（`4905bcf`）、格式选择器一行化 + 批量页一体卡（`0ae3870`）。

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M5** | 信息架构重构：导航三项（下载/文库/设置）+「下载」页双模式（URL/公众号）+「书架」→「文库」改名（含 e2e 选择器更新） | ✅ 已合入 main |
| **M6** | 下载闭环 + 历史：结果区就地确认/阅读（R1）+ 下载历史 `history.json`（R2） | ✅ 已合入 main |
| **M7** | 反馈引导：频控退避可见 + 失败话术归一（R5）；R3「完成/取消回到配置」既有流程已满足、无需新控件 | ✅ 已合入 main |
| **M8** | 保真与打磨：PDF 防跨页切断（R4，`@media print` 注入 HTML）；R7 库根提示已在 M6 完成 | ✅ 已合入 main |
| **M9** | 文库组织：排序 / 按公众号筛选+分组 / 批量删除（R6）+ 卡片⇄列表（访达式）视图切换 | ✅ 已合入 main |

非目标（v0.2.0 不做）：其他形式内容保真（公式/音视频卡片/合集…）、mac 签名公证、应用内更新、整本导出、多 session。
