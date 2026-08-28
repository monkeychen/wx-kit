# wx-kit v0.10.0 产品需求文档（迭代 PRD）

> **状态：R1 已实施完毕，最终形态与初版设计有重大收缩（见 §6，2026-08-28）**。
> §1–§5 保留初版设计与决策过程；§6 为验收时点的最终形态，**逐条验收以 §6 为准**。

## 1. 一句话定义

**同一种能力，换一条活路。**

按公众号下载与订阅是 v0.8.5 的核心能力，M49 因 MP 后台私有接口被封而退场。
v0.10.0 用**微信读书移动端接口**重建同一套产品能力：用户视角的功能面（订阅、
按号批量下载、digest、检查调度）回到 v0.8.5 形态，底层列表后端整体切换。

## 2. 背景与事实依据（2026-08-26 调研）

### 2.1 雷一言文章方法的时效性

文章《我找到了公众号文章抓取的最新方法》（2026-08-10，已入库）介绍的 WeRSS 走微信读书
**Web 端** `/web/mp/articles`。we-mp-rss 于 2026-08-13（1.5.2 版）确认：**该接口已被微信读书
废弃，恒返回 -2041**，Web 端只剩 `/api/mp/cover`（每号仅最新一篇）。**照抄文章方案不可行。**

### 2.2 采用的替代链路（微信读书移动端接口）

依据 `johamwon/wechrss` 公开实现（2026 年现行形态）与 rachelos/we-mp-rss issue #442：

| 能力 | 接口 | 说明 |
|---|---|---|
| 登录 | `i.weread.qq.com/wxticket` → `open.weixin.qq.com/connect/sdk/qrconnect` → 轮询 `long.open.weixin.qq.com` → `POST i.weread.qq.com/login` | 纯 HTTP 扫码（墨水屏设备 profile），换 `accessToken`/`refreshToken`/`vid`，**无需 BrowserWindow 加载微信页面** |
| 凭据续期 | `refreshToken` 重放 `/login` | 自动续期一次，失败引导重新扫码 |
| 账号识别 | 文章页 HTML `biz` 变量 → base64 解码 → `MP_WXS_<数字>` bookId；`/book/info` 取名称 | 已实测：`MzYzNDg1MDcyNQ==` ⇄ `MP_WXS_3634850725` |
| 文章列表 | `GET i.weread.qq.com/mp/chapters?bookId=&count=&synckey=0`（首页）/ `&offset=`（翻页，二者互斥） | **完整分页列表**，含标题/时间/摘要/原文链接/`readNum`/`likeNum` |
| 正文下载 | 列表条目 → `mp.weixin.qq.com/s/<token>` → **现有 `downloadArticle` 链路原样复用** | 公开页无需登录态；视频/图片/消息类型适配全部保留 |

### 2.3 与 v0.8.5 能力面的差异（必须向用户言明）

| 能力 | v0.8.5（MP 后台） | v0.10.0（微信读书） |
|---|---|---|
| 按名字搜索公众号 | ✅ `searchbiz` | ❌ 微信读书无搜索接口；入口改为**粘贴任意一篇文章链接**识别 |
| 完整历史列表 | ✅ | ✅ `/mp/chapters` 分页（spike 验证页深上限） |
| 消息类型预信号（`itemShowType`） | ✅ 列表直接给 | ⚠️ 列表不提供；下载后 `meta.json` 仍有（digest 清单降级） |
| 阅读/点赞数 | ❌ | ✅ **新增数据**（仅微信读书收录的文章） |
| 登录体验 | 扫码开 BrowserWindow | 扫码（应用内二维码 / CLI 终端二维码），更轻 |
| 前置条件 | 需要自己的公众号后台 | 微信读书账号；目标号需被微信读书收录 |

## 3. 需求清单

### R1 · 列表后端切换为微信读书，复活按公众号下载与订阅（2026-08-26 安哥）

**原始需求**：根据雷一言文章思路，重新开放基于公众号的文章下载与订阅；功能参考 v0.8.5
及以前，后台接口切换到新的可用接口。

**方案（本次调研后确定）**：

- **分层**：新增 `src/core/weread/` 适配层（client 纯逻辑 + 凭据 + bookId 换算 + 错误翻译），
  订阅检查/抓取/digest 的编排层只换依赖注入，不改语义。下次后端再死，退场的是一个适配器。
- **列表走微信读书，正文走 mp.weixin 公开页**：判重体系（`ArticleRef` 主键 →
  `DownloadQueue` 透传 → `articleId`）沿用；微信读书列表不给 `appmsgid/itemidx`，
  由 `parseArticle` 从文章页 HTML 提取 `mid/idx` 补齐 hint（跨 URL 形态判重的兜底，
  手动粘贴短链同样受益）。
- **登录态**：`weread-creds.json`（0600，userData 下）。GUI 应用内二维码；CLI `login`
  终端 ASCII 二维码 + 浏览器备选 URL。`-2041/-2012/-2010` 与 HTTP 401/403 → 登录态失效，
  HTTP 429 → 频控熔断（进既有 protection 状态，不自动重试）。
- **请求治理**：微信读书请求进既有 `MpRequestGateway`（transport 按域名路由：微信读书走
  Node fetch + 设备头，mp.weixin 走 Chromium session），新增 kind `weread-auth`（8–15s 档）、
  `weread-list`（2.5–5s 档，对齐 WechRss 实测 2s 间隔 + 余量）。GUI/CLI 跨进程互斥沿用。
- **旧数据无损**：`subscriptions.json` 不迁移，运行时把老 base64 fakeid 换算为 bookId；
  新增账号统一存 `MP_WXS_<数字>` 形态。`Library` 按 `canonicalId` 认旧文，不重下。
- **CLI 复活**（命令名不变，`MP_BACKEND_UNAVAILABLE` 停用响应全部撤除）：
  - `login` 微信读书扫码；`auth-status` 读凭据（`--verify` 真探测一次）；
  - `search --url <文章链接>` 识别公众号（旧位置参数「名称」移除，help 注明）；
  - `crawl --fakeid <bookId|旧fakeid>` + `--count/--from/--to/--include/--exclude/--formats`；
  - `subscription list/check-now/results/digest [--download]` 全量复活；
  - `session export/import`（weread 凭据形态）；`protection status/pause/resume` 复活；
  - 5 个订阅设置键重新可读可写。
- **GUI 复活**：下载页「按公众号」模式（登录引导 → 粘贴链接识别 → 选范围 → 实时逐篇进度）、
  订阅页（含调度）、设置页订阅块。`MainLayout` 恢复订阅导航。

**Spike 验收关卡（实现的前置条件）**：真实扫码登录 → `/mp/chapters` 首页 + offset 翻页 ≥2 页 →
记录真实响应结构（条目字段、`readNum/likeNum` 覆盖度、`originalId`→短链可用性、页深上限）。
若 `/mp/chapters` 不可用：降级 Plan B = `/api/mp/cover` 最新一篇增量（订阅仍可行，
`crawl` 语义降级为「从今往后」，需求面另行向安哥确认）。

## 4. 里程碑拆分

| 里程碑 | 需求 | 内容 |
|---|---|---|
| **M52** | R1 | 微信读书后端 core + CLI 复活：weread 适配层、gateway 域名路由、判重兜底、七个命令组复活、单测 |
| **M53** | R1 | GUI 复活：二维码登录组件、AccountMode/Subscriptions/Settings 恢复接线、e2e |
| 发版 | — | v0.10.0：README/AGENTS/ROADMAP/devlog/skill 同步、打包真实验收、三渠道发布 |

## 5. 非目标

- **不做 RSS/Atom 输出**。wx-kit 是下载器与本地文库，不是订阅源服务器。
- **不走微信读书正文接口**（`/web/mp/content`）。公开页解析链路已覆盖消息类型/视频/图片保真，
  且无需登录态；两条正文链路只会加倍风控面。
- **不做 addToShelf 书架写入**（移动端列表接口不需要书架关系；spike 若证明需要再议）。
- **不复活按名字搜索**（微信读书无此接口，入口统一为文章链接识别）。
- **不做微信读书账号池/多凭据**。单用户单账号，与产品定位一致。
- **不迁移/清理旧 MP 后台实现源码**（`mp-client.ts` 等保留，与 M49 同理）。

## 6. 最终形态与收缩（2026-08-27/28，验收以此为准）

实施过程中发生两次服务端事实反转，初版设计（§2–§5 中下列内容）相应**作废**：

### 6.1 事实链（按时间序）

1. **2026-08-26**：初版设计按 §2.2 走移动端接口。当日实测即发现移动端
   `/mp/chapters` 对墨水屏设备 token 恒 `-2041`（强风控）→ 启动 Plan B：
   Web 端 `/api/mp/cover`（每号仅最新一篇）。§2.2 全表作废。
2. **2026-08-27**：登录改为 Web 端 `weread.qq.com/api/auth/*`；真机连续修复
   数字 `vid`、`~↔_` token 不一致、Cookie 全量落盘等问题。
3. **2026-08-27/28（spike 终局）**：`web/mp/articles` 列表接口确认为**服务端
   按账号封禁**——真 Chrome 全新扫码登录（renewal 可轮换、身份健康）后列表仍
   `-2041`；此前「网络栈指纹分级」归因被该实验否定。结论与证据固化在
   `AGENTS.md` 关键约束与 `docs/plans/2026-08-27-fix-weread-web-login.md`。
4. **2026-08-28（安哥决策）**：批量下载入口（GUI+CLI）停用；订阅保留并补
   去重/删除/行内检查隔离（`docs/plans/2026-08-28-v0.10.0-scope-tighten.md`）。

### 6.2 v0.10.0 实际交付形态

| 能力 | 状态 | 说明 |
|---|---|---|
| 按 URL 下载 | ✅ 不变 | 不依赖登录态，主链路 |
| 识别公众号（`search --url` / GUI 粘贴链接） | ✅ | 用于订阅添加 |
| 公众号订阅（添加/检查/自动下载/水位增量） | ✅ | 列表不可用时回退 `cover` 最新一篇 |
| 订阅页删除 + 新旧标识去重 + 行内检查隔离 | ✅ 新增 | 旧版 base64 订阅自动归一为 `MP_WXS_`，数据无损 |
| 微信读书扫码登录（Web 端，Chromium 网络栈） | ✅ | `login` / 设置页二维码 / `session export/import` |
| 按公众号批量下载历史（GUI 入口 + `crawl`） | ❌ 停用 | `crawl` 稳定拒绝 `MP_BACKEND_UNAVAILABLE`（退出码 2，零网络）；GUI 模式页签移除 |
| `readNum/likeNum` 新增数据 | ❌ 未交付 | 依赖全量列表，随列表封禁一并不可用 |
| `digest` | ⚠️ 降级 | 仅覆盖最新一篇（列表封禁所致） |

### 6.3 验收清单（逐条）

- [ ] `wx-kit crawl …` 返回 `MP_BACKEND_UNAVAILABLE` JSON、退出码 2、零网络请求；
- [ ] 「下载」页无「按公众号」模式页签（e2e 断言 `mode-account` 不存在）；
- [ ] 旧版订阅文件（base64 fakeid）在新版列表自动归一、无重复行、水位取较大值；
- [ ] 订阅行可删除且删除后不再回来（历史派生行不复活）；重新订阅可撤销删除标记；
- [ ] 行内「检查」仅本行进入检查态，结果只落本行；
- [ ] 扫码登录后订阅检查可用（`cover` 增量），未登录返回 `AUTH_REQUIRED`；
- [ ] e2e ALL PASSED、474+ 单测/lint/tsc/build 全绿。
