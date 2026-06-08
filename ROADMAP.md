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

## 当前状态
- M4 打包已通：未签名 mac dmg(arm64+x64) + win nsis x64 安装包，品牌「宝盒」图标。打包后真实启动 .app 验证通过（undici external 站得住）。win-from-mac 在本机也跑通，未启用 CI 兜底。
- M3.5 批量爬取已有 GUI：整页登录引导 → 搜号 → 选范围/格式 → 实时逐篇进度（取消=停后续保留已下，失败可单篇重试）。缓存 session 有效期内免扫码，真实账号 GUI 端到端验证通过。
- M3 CLI 切片：扫码登录持久化 session、`appmsg` 列文章、复用 M1 管线落盘。
- M2 GUI 为「暖色编辑杂志风」：刊头横导航、封面卡片书架、友好格式选择、editorial 阅读版面。
- 测试规模不在此写死数字——跑 `npm test`（单测）与 `npm run test:e2e`（GUI 端到端）看当前真实结果。

## 下一步
第一阶段功能（M1–M3.5）与分发（M4）已齐活，v0.1.0 可分发物：`release/wx-kit-0.1.0-arm64.dmg`、`release/wx-kit-0.1.0.dmg`、`release/wx-kit Setup 0.1.0.exe`。

## v0.2.0 迭代（规划中）
需求见 `docs/PRD-v0.2.0.md`。主题：把下载闭环做扎实、信息架构理顺——「下得放心、找得到、看得见」。
> v0.1.0 收尾期已随手修复：md 代码块丢失 / 发布时间解析 / fetch 硬超时（`4905bcf`）、格式选择器一行化 + 批量页一体卡（`0ae3870`）。

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M5** | 信息架构重构：导航三项（下载/文库/设置）+「下载」页双模式（URL/公众号）+「书架」→「文库」改名（含 e2e 选择器更新） | ✅ 已合入 main |
| **M6** | 下载闭环 + 历史：结果区就地确认/阅读（R1）+ 下载历史 `history.json`（R2） | 规划中 |
| **M7** | 流程可回退（R3）+ 反馈引导：频控退避可见 + 失败话术（R5） | 规划中 |
| **M8** | 保真与打磨：PDF 图片防跨页切断（R4）+ 库根提示完善（R7），可与任意里程碑搭车 | 规划中 |
| **M9** | 文库组织：排序 / 按公众号分组筛选 / 批量删除（R6） | 规划中 |

非目标（v0.2.0 不做）：其他形式内容保真（公式/音视频卡片/合集…）、mac 签名公证、应用内更新、整本导出、多 session。
