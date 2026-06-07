# M3 设计：扫码登录 + 公众号批量爬取

> 状态：已与安哥对齐（2026-06-07）。本文件是**设计依据**（为什么这么设计）；
> 实现步骤由 writing-plans 产出到 `docs/plans/2026-06-07-m3-login-and-crawl.md`。
> 范围决策：**CLI 优先**——本里程碑只做无头核心 + CLI，GUI 批量页留到下一切片。

## 1. 背景与已知条件

原型 `../trae/x-downloader/wx-scrapy/`（Python，仅参考）已跑通 mp.weixin.qq.com 后台接口，
关键机制确定、且 `data/articles/*.json` 有真实返回样本。本里程碑用 TS 重写，并**用 Electron 自带
`BrowserWindow` + `session.cookies` 取代 Playwright/独立 chromium**（贴合「无 Python、无独立浏览器」既定决策）。

唯一真实风险：原型数据是 2026-02 的，接口到 2026-06 可能变。故**计划第 1 步为活体验证 spike**
（安哥扫一次码，确认 token/cookies 抓得到、searchbiz 返回正常）再建其余。

接口事实（来自原型，待 spike 复核）：
- 登录：浏览器载入 `https://mp.weixin.qq.com/`，扫码后重定向到 `**/cgi-bin/home?...token=N`；
  token 在 URL query，cookies 在会话里。
- 搜号：`GET /cgi-bin/searchbiz`，params `action=search_biz, token, lang=zh_CN, f=json, ajax=1, random, query=<name>, begin=0, count=5`；返回 `list[]`，每项含 `fakeid / nickname / alias`。
- 列文章：`GET /cgi-bin/appmsg`，params `action=list_ex, begin, count, fakeid, token, lang=zh_CN, f=json, ajax=1, type=9, query=""`；返回图文列表，按 `begin/count` 翻页。
- 风控信号：`base_resp.ret` — `0` 正常；`200013` 频控；`200040` token 失效。

## 2. 架构原则

延续 M1/M2 的 core/electron 分层：**electron 依赖全部收进「登录」与「发请求」两个薄适配器，
爬取发现与编排是 UI 无关纯逻辑（可注入、可单测），落盘 100% 复用 M1 的 `downloadArticle`。**

| 模块 | 层 | 职责 | 依赖 |
|---|---|---|---|
| `electron/services/mp-auth.ts` | 主进程 | 开窗扫码、捕获并持久化 session、查询/清除 | electron `BrowserWindow`、fs |
| `electron/services/mp-fetch.ts` | 主进程 | 生产用 `mpRequest(endpoint, params, session)`：axios GET 带 cookie/UA/Referer/Host，返回 JSON | axios |
| `src/core/mp-client.ts` | 纯逻辑 | `searchAccount` / `listArticles`：翻页 + 随机延迟 + ret 码判定 | 注入 `mpFetch` |
| `src/core/mp-crawl.ts` | 纯逻辑 | `crawlAccount`：列 URL → 复用 `DownloadQueue`+`downloadArticle` 串行落盘 + 去重 + 失败不中断 + 退避 | 注入 deps（含 mp-client、library、downloadArticle） |
| `src/cli/index.ts` | CLI | 新增 `login / auth-status / search / crawl / library list` | 上述全部 |

**接口契约（单元可独立理解）**：
- `mpFetch(endpoint: string, params: Record<string,string>): Promise<MpJson>` —— 唯一外部副作用入口，
  纯逻辑只依赖它，故测试用假实现 + 原型 JSON fixture 即可全覆盖。
- `Session = { token: string; cookies: {name,value}[]; timestamp: number }`。

## 3. 登录与 session 流转（mp-auth）

- `login(): Promise<Session>` —— 开可见 `BrowserWindow`（~480×640）载入 `mp.weixin.qq.com`。
  监听 `webContents` 导航，命中 `/cgi-bin/home?` 且 URL 含 `token=` → 取 token、
  `webContents.session.cookies.get({ url: 'https://mp.weixin.qq.com' })` 取 cookies → 持久化 → 关窗。
- **取消**：用户未登录即关窗 → reject `CANCELLED`，不抛裸错。
- **持久化**：`userData/mp-session.json`，结构即 `Session`。**不进文章库、不进代码、不进 git。**
- `getSession(): Session | null`、`clearSession(): void`。
- session 失效（运行时 `200040`）→ 由调用方触发 `AUTH_REQUIRED`，GUI 弹登录 / CLI 返回错误码。

## 4. 爬取与风控（mp-client + mp-crawl）

### mp-client（纯逻辑，注入 mpFetch）
- `searchAccount(mpFetch, name): Promise<Account[]>` —— 调 searchbiz，映射为 `{ fakeid, nickname, alias, ... }[]`。
  **返回候选列表，不自动选**（PRD 已决议）。
- `listArticles(mpFetch, fakeid, range): Promise<ArticleRef[]>`，`range = { count: N } | { from, to }`：
  - `count`：`begin += count` 翻页累计到 N。
  - `from/to`：翻页直到某页 `update_time < from`，再按窗口过滤。
  - 翻页之间插入随机延迟。
  - `ret` 判定：`200013` → 抛 `MpRateLimited`；`200040` → 抛 `MpAuthExpired`；其它非 0 → `MpApiError`。
  - `ArticleRef = { url, title, publishTime, digest, cover }`（来自 appmsg 项）。

### mp-crawl（纯逻辑编排）
- `crawlAccount({ fakeid, range, formats }, deps): Promise<CrawlSummary>`：
  1. `listArticles` 得到 `ArticleRef[]`。
  2. **复用 `DownloadQueue`**：把 ref 的 URL 串行喂给 `downloadArticle`（M1），逐篇之间插入随机延迟；
     去重靠现成 `articleId`+`library.has`；单篇失败记录并继续（`DownloadQueue` 已有此语义）。
  3. 命中 `MpRateLimited` → 指数退避（30s 起，≤3 次）仍失败则中止并报 `RATE_LIMITED`。
- **续传**：每篇落盘即写 `library.json`，崩溃/中断后重跑自动跳过已下。

### 防风控默认值（保守，设置可调 —— PRD §9）
- appmsg 翻页间：随机 **1–3s**。
- 文章下载间：随机 **2–5s**（更重更显眼，放更慢）。
- 退避：`200013` 指数退避 30s 起，最多 3 次。

## 5. CLI 契约

沿用既有约定：stdout 纯 JSON（仅结束时一次）、stderr 进度、退出码 `0` 成功 / `1` 业务失败 / `2` 用法或鉴权错误。

| 命令 | 作用 | 关键参数 | 输出 |
|---|---|---|---|
| `login` | 开窗扫码、持久化 session | — | `{ ok, account? }` |
| `auth-status` | 查登录态（默认做一次廉价真探测，避免说谎） | `--json` | `{ ok, valid, account? }` |
| `search <name>` | 搜公众号，返候选 | `--json` | `{ ok, list:[{fakeid,nickname,alias,...}] }` |
| `crawl` | 批量爬取 | `--fakeid <id>` 或 `<name>`、`--count N` 或 `--from --to`、`--formats`、`--out` | `{ ok, ...CrawlSummary }` |
| `library list` | 列已下文章（复用现成 `Library`） | `--account <name>`、`--json` | `{ ok, items:[...] }` |

- `crawl <name>`：内部 `searchAccount` 解析 name→fakeid；**有歧义则报错并附候选**，引导改用 `--fakeid`（贴「search 返候选、调用方选」）。
- `search/crawl/auth-status` 需登录态；无有效 session → `{ ok:false, error:{ code:"AUTH_REQUIRED" } }` 退出码 2。
- `login` 在 CLI 模式下仍开窗（与 PDF 离屏窗同理，主进程已 `whenReady`）。

## 6. 错误处理与测试策略

**错误码**（均带"下一步怎么办"，不只报问题）：
`AUTH_REQUIRED`（无/失效 session → 提示先 `login`）、`RATE_LIMITED`（退避耗尽 → 提示稍后再试/调大延迟）、
`MP_API_ERROR`（其它 ret）、`NETWORK`、`CANCELLED`（用户关窗）。

**测试**：
- `mp-client` 纯逻辑 → vitest 单测，**直接拿原型 `data/articles/*.json` 真实返回当 fixture**；
  覆盖：翻页累计、日期窗口截断、`200013/200040/其它 ret` 三种码路径。
- `mp-crawl` → 注入假 `mpFetch` + 假 `library` + 假 `downloadArticle`，覆盖：串行顺序、去重跳过、
  单篇失败不中断、退避触发。
- CLI → 输出契约测试（stdout 纯 JSON、AUTH_REQUIRED 退出码 2）。
- `mp-auth` 不单测（electron 绑定）→ 由**计划第 1 步活体验证 spike** + 手动覆盖；不进自动化 e2e（需真实登录）。

## 7. 非目标（本里程碑明确不做）
- GUI 批量页（搜号/选范围/实时队列）——下一切片。
- MCP server 封装——更后。
- 暂停/恢复的 UI 控件——CLI 阶段以"可重跑续传"替代。
