# v0.10.0 M52 微信读书后端实现计划

> 需求：`docs/PRD-v0.10.0.md` R1。M52 = core + CLI；M53 = GUI（同分支，另行 commit）。
>
> 实施日期：2026-08-26 起。前置调研结论见 PRD §2（接口形态依据 wechrss 2026 现行实现）。
>
> 状态：进行中。

## 0. 设计总则

1. **适配层隔离**：微信读书全部细节收在 `src/core/weread/`。订阅/抓取/digest 编排层的
   语义不变，只换列表函数的注入。
2. **列表走微信读书，正文走 mp 公开页**。
3. **退场约束保留**：旧 MP 后台私有 kind 在 gateway transport 前继续硬拒绝。
4. **【M52 关键转向 (Plan B)】**：2026-08-26 实测确认，移动端接口 `i.weread.qq.com/mp/chapters` 
   对墨水屏设备 token 施加了严格风控（恒返回 499 / -2041），该接口实质性阻断。
   根据 PRD 预案，**启动 Plan B：降级为 Web 端 `/api/mp/cover` 接口**。
   - 影响 1：**无法获取历史列表**，每次仅返回**最新一篇**文章。`crawl` 批量下载名存实亡，只能做增量订阅。
   - 影响 2：该接口不返回发布时间（`createTime`）。必须在列表阶段额外 fetch 一次文章 HTML，提取发布时间供水位判定。
   - 影响 3：鉴权需改为 Web Cookie 形态（`wr_vid=...; wr_skey=...`），扫码拿到的 `accessToken` 即是 `skey`。

## 1. Task 分解

### Task 1：core/weread 纯逻辑层（先测后写）

| 文件 | 内容 | 关键测试 |
|---|---|---|
| `types.ts` | `WereadCredentials`（vid/accessToken/refreshToken/deviceId/name/updatedAt）、`WereadChapter`、`WereadBookInfo` | 形状校验 |
| `book-id.ts` | `bookIdFromBiz(b64)`、`bizFromFakeid`、`normalizeAccountId(fakeid\|bookId)`（base64 老 fakeid → `MP_WXS_<数字>`；已是新形态原样过；非法抛错） | 雷一言实测样本 `MzYzNDg1MDcyNQ==` ⇄ `MP_WXS_3634850725`；padding 缺失；非数字解码结果 |
| `parse-articles.ts` | `parseChapters(payload)`：当前移动端 `{data:[{reviewId,title,createTime,mpInfo:{readNum,likeNum,originalId,pic_url,content}}]}` + 旧版 `reviews[].subReviews[].review` 双形态 → `ArticleRef[]`（含 `readNum/likeNum`）；`articleUrlFromEntry`：`doc_url/url` 直用 → `originalId` 以 `/s`、`?__biz=`、裸 token 三形态拼 mp 短链/长链（token 中 `~` 原样保留） | 两形态 fixture；URL 三形态；空 reviewId 跳过；errCode 翻译 |
| `client.ts` | `WereadClient`（注入 `wereadFetch: (path, params) => Promise<unknown>`）：`listChapters(bookId, {count, offset?})`（首页 synckey=0 不带 offset；翻页 offset 不带 synckey——**混用会被服务端拒**）、`bookInfo(bookId)`、`listChaptersSince(bookId, sinceTs, cap)`（翻到水位为止，对齐 `listArticlesSince` 语义）、`listChaptersByRange(bookId, range)`（count/from-to，对齐 `listArticles`） | 翻页游标；水位停止；错误码：`-2041/-2012/-2010`→`WereadAuthExpired`（零重试）、HTTP 429/`errCode` 风控→`MpRateLimited`、其他→`MpApiError` |
| `qr-flow.ts` | `startQrLogin(deps)`：wxticket → qrconnect（返回 confirmUrl + uuid）→ `poll(uuid, last)` 状态机（405 confirmed/404 scanned/408 waiting/402 expired/403 declined）→ `exchange(wxCode)`：deviceId/installId 生成、sha256 签名、POST /login → credentials。全部 HTTP 注入 | 各 wx_errcode 分支；签名串 `ts+deviceId+random`；402 换码重入 |
| `creds-store.ts` | `WereadCredsStore(path)`：read/write（0600）、`refresh(creds)`（refreshToken 重放 /login） | 读写权限；损坏文件抛可读错误 |
| `refresh.ts` | 并入 creds-store 或独立——refreshToken 续期编排 | 过期降级为 authExpired |

`ArticleRef`（`mp-types.ts`）加 `readNum?: number; likeNum?: number`。
`ArticleMeta`（`types.ts`）加同名可选字段，exporter 写入 meta.json（微信读书列表给了才写）。

### Task 2：判重兜底——文章页提取 mid/idx

- `parse-article.ts` 导出 `extractArticleKeys(html): { mid?: string; idx?: string }`
  （正则 `var mid = "(\d+)"` / `var idx = "(\d+)"`；已实测存在）。
- `download-article.ts`：无 hint 且 id 为 `h_` 哈希形态时，fetchHtml 后提取 mid/idx，
  命中则用 `mid_idx` 重算 id 再查一次 `library.has`（命中即 skipped）。hint 优先级不变。
- 效果：微信读书列表下载与手动短链下载归一到同一 id；手动重复粘贴短链不再重复入库
  （老 `h_` 存量条目无法归一，属历史限制，PRD 已注明）。

### Task 3：gateway 接入微信读书

- `mp-request-governor.ts`：`MpRequestKind` 加 `'weread-auth' | 'weread-list'`；
  `MP_REQUEST_INTERVALS` 补 `weread-auth: [8_000,15_000]`、`weread-list: [2_500,5_000]`。
- 新 `electron/services/routing-transport.ts`：`implements MpRequestTransport`，按 hostname
  分发——`weread.qq.com/i.weread.qq.com/open.weixin.qq.com/long.open.weixin.qq.com` →
  `WereadTransport`（Node fetch + 设备版本头 + `accessToken/vid`，构造时注入 `getCreds`）；
  其余走现有 `ChromiumMpTransport`。gateway 本体零改动。
- `isRetiredPrivateRequest` 保持原样（旧三 kind 继续拦）。

### Task 4：electron 服务与 IPC

- `electron/services/weread-auth.ts`：`getWereadCreds()/saveWereadCreds()/clearWereadCreds()`
  （userData/weread-creds.json，0600）；`ensureFreshCreds()`（有 refresh 则试续期一次）。
- `electron/ipc.ts` 复活 + 新增：
  - `weread:login-start` → confirmUrl（渲染层用 `qrcode` 包画）；`weread:login-cancel`
  - `weread:auth-status` / `weread:logout`（清凭据，不动 Chromium 分区——微信读书不占）
  - `mp:search` 语义换：入参 `{ articleUrl }` → 抓文章页（article-page kind）→ 提取 biz/nickname
    （`parse-account` 已有）→ bookId → 可选 `/book/info` 校验 → 返回账号信息
  - `mp:crawl` / `subscriptions:*` / `protection:*` 恢复原 handler，内部依赖换 weread
- `electron/main.ts`：恢复订阅调度器启动（`subscriptionAutoCheck` 默认值改 false？
  ——设置默认本来就是 false，保持）。

### Task 5：编排层换后端

- `check-subscriptions.ts`：`CheckDeps` 的 `mpFetch+token` 换成必注入
  `list: (fakeid, sinceTs) => Promise<ArticleRef[]>`（调用方做 bookId 归一）。
- `mp-crawl.ts`：`CrawlDeps.listFn` 默认实现换 weread `listChaptersByRange`。
- `subscription-digest.ts`：调用方构造 `listByDate` 换 weread。
- `subscription-check.ts`：`session` 判断换 weread creds；`no-session` note 保留。
- 所有入口（ipc/cli）构造 weread 实现时统一 `normalizeAccountId`。

### Task 6：CLI 复活

- `retired-private-api.ts`：`PRIVATE_API_FEATURE_ENABLED = true`；
  `RETIRED_PRIVATE_API_COMMANDS` 清空（保留导出与测试文件，改断言空集）；
  `RETIRED_PRIVATE_API_SETTING_KEYS` 清空。
- `src/cli/index.ts`：
  - `login`：终端 ASCII 二维码（`qrcode-terminal`）+「浏览器打开」备选输出 confirmUrl；
  - `auth-status`：读凭据，`--verify` 真调一次 `/book/info`（weread-auth kind）；
  - `search --url <文章链接>`（位置参数「名称」移除，`-h` 注明变更）；
  - `crawl`/`subscription`/`protection`/`session` 接回（session 的 validate 换 weread 形态）；
  - settings 5 键解锁（settings-cli.ts 过滤逻辑解除）。
- `cli-dispatch.ts` 白名单不变（命令名没动）。

### Task 7：测试与验收

- 单测：weread 层全部 + 判重兜底 + 适配层注入 + CLI 契约（7 命令真输出、search --url、
  help 不再标停用）+ gateway weread kinds。
- 既有测试更新：`retired-private-api.test.ts`（断言翻转）、`cli-contract.test.ts`、
  `mp-request-gateway.test.ts`。
- 真实验收（spike 凭据就绪后）：CLI `login` → `search --url <雷一言文章>` →
  `crawl --count 3` → `subscription` add/check-now/digest --download → 与手动下载的
  判重核对（同文章 skipped）。
- `npm test` / `npm run lint` / `npx tsc --noEmit` / `npm run test:e2e`（M53 后）。

### Task 8：M53 GUI（另行 commit）

- `Download.tsx` AccountMode：登录引导改二维码 Modal（`qrcode` 包生成 dataURL img），
  「粘贴文章链接识别公众号」替代搜号输入框；CrawlProgress 复用。
- `Subscriptions.tsx` 恢复路由（App.tsx、MainLayout 导航 + 角标）。
- `Settings.tsx` 恢复订阅块与「微信读书账号」区。
- e2e：fixture 模式（注入假 weread client）恢复订阅/批量流。

### Task 9：文档与收尾

- `agent/wx-kit-skill/` 三处同步（SKILL.md、commands.md、recipes.md）；
- AGENTS.md 更新已定决策（微信读书后端、移动端接口事实、判重兜底）；README 能力面；
- ROADMAP 里程碑行 + devlog 增补；`docs/releases/v0.10.0.md` 发版时写。
- 合回 main、删分支（自动收尾，惯例）。

## 2. 完成定义

- CLI 七命令组真实可用（真机验收记录在 PRD §4 勾选）；
- 订阅检查/调度/自动下载/digest 与 v0.8.5 行为等价（水位、留痕、部分失败语义）；
- 判重：微信读书列表下载、手动短链、老库 `mid_idx*` 三方互认；
- 旧 MP 后端私有 kind 在 transport 前仍被拒（零回归）；
- test/lint/typecheck/e2e 全绿；spike 真实响应已校准解析器。
