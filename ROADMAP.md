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
| **M4** | electron-builder 打包，macOS + Windows 跨平台 | ⏳ 待办 |

## 实现计划（docs/plans/）
各里程碑的详细实现计划放在 `docs/plans/`，索引在此维护：
- **M1** — `docs/plans/2026-06-06-m1-core-and-url-download.md`
- **M2** — `docs/plans/2026-06-06-m2-gui.md`
- **M3** — `docs/plans/2026-06-07-m3-login-and-crawl.md`（设计依据 `docs/superpowers/specs/2026-06-07-m3-login-crawl-design.md`）
- **M3.5** — `docs/plans/2026-06-07-m3.5-batch-crawl-gui.md`（设计依据 `docs/superpowers/specs/2026-06-07-m3.5-batch-crawl-gui-design.md`）
- **M4** — 待建

## 当前状态
- M3.5 批量爬取已有 GUI：整页登录引导 → 搜号 → 选范围/格式 → 实时逐篇进度（取消=停后续保留已下，失败可单篇重试）。缓存 session 有效期内免扫码，真实账号 GUI 端到端验证通过。
- M3 CLI 切片：扫码登录持久化 session、`appmsg` 列文章、复用 M1 管线落盘。
- M2 GUI 为「暖色编辑杂志风」：刊头横导航、封面卡片书架、友好格式选择、editorial 阅读版面。
- 测试规模不在此写死数字——跑 `npm test`（单测）与 `npm run test:e2e`（GUI 端到端）看当前真实结果。

## 下一步：M4（打包）
第一阶段功能已齐（URL 下载 / 批量爬取 / 书架阅读 / CLI）。下一步 electron-builder 打包出 macOS + Windows 可分发产物。新里程碑照例先出 `docs/plans/` 计划。
