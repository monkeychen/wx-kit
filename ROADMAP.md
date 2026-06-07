# wx-kit — 路线图与状态

> 项目进度的「状态板」。`AGENTS.md` 是稳定的宪法（决策/不变量/陷阱），刻意不放易变的状态——
> 状态看这里。更细的真相以 `git log` 与 `docs/plans/` 的实现计划为准。

## 里程碑

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M1** | 工程骨架 + UI 无关核心层 + CLI `wx-kit download`（cover/md/html/pdf/meta 五格式）+ 文章库索引 | ✅ 已合入 main |
| **M2** | GUI：应用壳 + URL 下载页（实时进度）+ 文章库（搜索/删除/在文件夹显示）+ 内置阅读器（md/html）+ 设置；IPC 桥；`wxfile://` 协议；GUI 端到端测试 | ✅ 已合入 main |
| **M3** | 扫码登录 mp.weixin.qq.com 后台 + 公众号批量爬取（按数量/日期范围）；CLI `login`/`search`/`crawl`/`library list` | ⏳ 待办（计划：`docs/plans/2026-06-07-m3-login-and-crawl.md`） |
| **M4** | electron-builder 打包，macOS + Windows 跨平台 | ⏳ 待办 |

## 当前状态
- M2 GUI 已重构为「暖色编辑杂志风」（2026-06）：刊头横导航、封面卡片书架、友好格式选择、editorial 阅读版面。
- 测试规模不在此写死数字——跑 `npm test`（单测）与 `npm run test:e2e`（GUI 端到端）看当前真实结果。

## 下一步：M3
扫码登录 + 公众号批量爬取。起点提示与约束已落在计划占位文件
`docs/plans/2026-06-07-m3-login-and-crawl.md`，正式开工前先把它补成完整 plan（参照 M1/M2 规格）。
