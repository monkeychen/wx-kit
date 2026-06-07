# wx-kit — 路线图与状态

> 项目进度的「状态板」。`AGENTS.md` 是稳定的宪法（决策/不变量/陷阱），刻意不放易变的状态——
> 状态看这里。更细的真相以 `git log` 与 `docs/plans/` 的实现计划为准。

## 里程碑

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M1** | 工程骨架 + UI 无关核心层 + CLI `wx-kit download`（cover/md/html/pdf/meta 五格式）+ 文章库索引 | ✅ 已合入 main |
| **M2** | GUI：应用壳 + URL 下载页（实时进度）+ 文章库（搜索/删除/在文件夹显示）+ 内置阅读器（md/html）+ 设置；IPC 桥；`wxfile://` 协议；GUI 端到端测试 | ✅ 已合入 main |
| **M3（CLI 切片）** | 扫码登录 mp.weixin.qq.com 后台 + 公众号批量爬取（按数量/日期范围）；CLI `login`/`auth-status`/`search`/`crawl`/`library list` | ✅ 已合入 main |
| **M3.5** | GUI 批量页（搜号 → 选范围 → 实时队列进度）+ 扫码登录引导 | ⏳ 待办 |
| **M4** | electron-builder 打包，macOS + Windows 跨平台 | ⏳ 待办 |

## 实现计划（docs/plans/）
各里程碑的详细实现计划放在 `docs/plans/`，索引在此维护：
- **M1** — `docs/plans/2026-06-06-m1-core-and-url-download.md`
- **M2** — `docs/plans/2026-06-06-m2-gui.md`
- **M3** — `docs/plans/2026-06-07-m3-login-and-crawl.md`（设计依据 `docs/superpowers/specs/2026-06-07-m3-login-crawl-design.md`）
- **M3.5 / M4** — 待建

## 当前状态
- M3 CLI 切片已通：扫码登录持久化 session、`appmsg` 列文章、复用 M1 管线落盘，真实账号端到端验证通过（登录→列→下载→入库）。
- M2 GUI 为「暖色编辑杂志风」（2026-06）：刊头横导航、封面卡片书架、友好格式选择、editorial 阅读版面。
- 测试规模不在此写死数字——跑 `npm test`（单测）与 `npm run test:e2e`（GUI 端到端）看当前真实结果。

## 下一步：M3.5（GUI 批量页）或 M4（打包）
M3 已把批量爬取交付到 CLI（agent 可调）。接下来二选一：给批量爬取补 GUI 页（M3.5），或先做 electron-builder 打包出可分发产物（M4）。新里程碑照例先出 `docs/plans/` 计划。
