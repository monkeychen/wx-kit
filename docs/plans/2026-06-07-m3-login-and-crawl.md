# M3 实现计划 — 扫码登录 + 公众号批量爬取

> ⚠️ **占位草稿，尚非完整计划。** 正式开工前需补成 M1/M2 同等规格：
> bite-sized 步骤、TDD、确切代码、依赖注入边界。本文件先沉淀起点提示与硬约束，避免散落在 `AGENTS.md`。

## 范围
- 扫码登录 mp.weixin.qq.com 后台，维持登录态。
- 按公众号批量爬取图文（按数量 / 日期范围）。
- CLI：`login` / `search` / `crawl` / `library list`（与 GUI 同一二进制，纯 JSON 输出契约见 PRD §F4）。

## 起点提示（从原 AGENTS.md 迁入）
- `electron/main.ts` 的 `CLI_COMMANDS` 已预留 `login/search/crawl/library`，分流逻辑就位，只差实现。
- **爬取路径**：走「扫码登录后台 + 调图文接口」这一条——**代理模式已弃用**（见 `AGENTS.md` 已定关键决策，勿回退）。
- **防风控**：默认串行 + 随机延迟（PRD §9）。已删除文章返回 HTTP 200 错误页 → 复用「解析后标题为空即视为无效」判定（`src/core/download-article.ts` 已有）。
- **参考但不照搬**：原型爬取逻辑在 `../trae/x-downloader/wx-scrapy/`（Python，仅作参考，本项目用 TS 重写）。

## 待定（开工前定清）
- 登录态/cookie 的存储位置与生命周期（不进代码、不进库索引）。
- 图文接口的请求构造、分页游标、失败重试与退避策略。
- 爬取结果如何复用现有 `downloadArticle` 落盘与 `library.json` 索引。
