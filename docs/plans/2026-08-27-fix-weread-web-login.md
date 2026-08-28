# Fix 401：微信读书登录换成 Web 端实现计划

> 缺陷：`feat/v0.10.0-weread-backend` 在真机 `npm run dev` 复现 `WereadNodeTransport.json HTTP 401`（`mp:crawl -> getLatestArticle`），扫码后仍弹登录。根因：登录用移动端墨水屏协议（`i.weread.qq.com/login`），业务用 Web 端 `weread.qq.com/api/mp/cover`，两套鉴权不互通；代码把移动端 `accessToken` 硬当 `wr_skey` 塞 Cookie。
>
> 目标：登录后端整体换成 Web 端扫码（`weread.qq.com/api/auth/*`），业务请求 `Cookie: wr_vid; wr_skey=refreshToken(web@)`，打通 `api/mp/cover`。e2e 的 mock 链路已验证 Web 端 cover 的增量形态可用，仅登录链路需重写。
>
> 依据：`rachelos/we-mp-rss` 的 `driver/weread_qr.py`（Web 端 `getLoginUid`/`getLoginInfo` + `wr_skey` 短值常被 `-2012` 拒、长令牌 `refreshToken(web@)` 有效 + `/web/login/renewal` 续期）。移动端 `wxticket/open.weixin/qrconnect` 链路不再使用。
>
> 分支：`feat/v0.10.0-weread-backend` 就地修复。状态：待实施。

## 0. 设计总则

1. **Web 端登录为唯一真相**：`weread.qq.com/api/auth/getLoginUid` 取 uid -> 二维码内容 `weread.qq.com/web/confirm?uid=...` -> 轮询 `getLoginInfo?uid=&otp=`。不再依赖 `i.weread.qq.com`、墨水屏 UA、设备画像、签名。
2. **凭据形态收敛**：`WereadCredentials` 存 `vid(webLoginVid)` + `refreshToken(web@)` + `accessToken`(短值，可选) + `updatedAt`。`deviceId` 不再需要（Web 端无此概念），保留字段兼容旧文件但不再生成。
3. **Cookie 有效值 = refreshToken**：`weread.qq.com` 业务请求统一 `Cookie: wr_vid=<vid>; wr_skey=<refreshToken>`。短值 `wr_skey` 常被 `-2012` 拒，需用长令牌兜底。
4. **续期走 Web 端**：`POST weread.qq.com/web/login/renewal`（body `{"rq":"%2Fweb%2Fbook%2Fread","ql":true}`，需带登录 Cookie），而非移动端 `refreshToken` 重放 `/login`。
5. **GUI 二维码渲染不变**：`useWereadLoginQr` 仍产 `qrDataUrl`，仅 `confirmUrl` 来源从 `open.weixin` 换成 `weread.qq.com/web/confirm`。
6. **Mock 链路保持**：`WXKIT_WEREAD_BASE` 与 `isWereadUrl` 的 Node 路由 seam 保留；e2e 的 `weread-creds.json` 仍可用（存 Web 端 vid/refreshToken）。

## 1. Task 分解（TDD，先测后写）

### Task 1：`src/core/weread/qr-flow.ts` 重写为 Web 端

| 文件 | 内容 | 关键测试 |
|---|---|---|
| `qr-flow.ts` | 删除移动端常量/函数：`WEREAD_BASE=i.weread`、`WEREAD_VERSION_HEADERS`、`newDeviceId/newInstallId`、`wereadSignature`、`startQrLogin(wxticket/qrconnect)`、`buildPollUrl(long.open.weixin)`、`parseQrPoll(wx_errcode)`、`buildLoginBody`、`exchangeQrCode`。新增 Web 端：`WEB_WEREAD_BASE=https://weread.qq.com`、`getLoginUid(http): Promise<{uid}>`、`webConfirmUrl(uid): string`、`pollLoginInfo(http, uid): Promise<WebLoginPoll>`（`succeed/logicCode` 归一，`LOGIN_TIMEOUT` 视为等待）、`parseWebLoginResponse(payload, jar): WereadCredentials`（提取 `webLoginVid/vid` + `refreshToken(web@)` + `accessToken` 短值 + Set-Cookie `wr_skey`，短值 <20 视为不可信，优先用 `refreshToken`）、`LOGIN_CONTENT_HEADERS` 保留 JSON 头 | `getLoginUid` 正常/非 200；`pollLoginInfo` 的 `succeed:true`/`LOGIN_TIMEOUT`/`NEED_OTP`/超时；`parseWebLoginResponse` 的 vid 缺失/短值丢弃/refreshToken 优先；`webConfirmUrl` 拼装 |
| `qr-flow.ts` | 导出 `WEB_WEREAD_BASE`、`WEB_LOGIN_POLL_TIMEOUT=70000`（长轮询挂起 70s，对齐 we-mp-rss） | 常量校验 |

旧移动端测试 `qr-flow.test.ts` 中 `wxticket`/`qrconnect`/`wx_errcode` 相关用例标记删除或重写为 Web 端形态；新增 Web 端用例覆盖上述分支。

### Task 2：`src/core/weread/types.ts` 与 `creds-store.ts`

| 文件 | 内容 | 关键测试 |
|---|---|---|
| `types.ts` | `WereadCredentials` 调整：`vid` 保留（Web 端 webLoginVid）、`accessToken` 保留（短值，可选）、`refreshToken` 必选（`web@` 长令牌，当 `wr_skey` 用）、`deviceId` 改为可选（兼容旧文件，新登录不再生成）、`name/updatedAt` 不变。注释写明 `wr_skey` 有效值 = `refreshToken` | 形状校验；旧文件无 deviceId 仍可读 |
| `creds-store.ts` | `WereadCredsStore` 读写（0600）不变。`refreshWereadCreds` 重写：不再 `POST i.weread/login`，改为 `POST weread.qq.com/web/login/renewal`（需带 `Cookie: wr_vid; wr_skey; wr_rt`，body `{"rq":"%2Fweb%2Fbook%2Fread","ql":true}`，从 Set-Cookie 抓新 `wr_skey`）。失败抛 `MpAuthExpired` 引导重扫 | renewal 成功更新 `wr_skey`；Set-Cookie 缺失时回退；网络失败抛可读错误 |

### Task 3：`electron/services/weread-transport.ts` Cookie 拼法

| 文件 | 内容 | 关键测试 |
|---|---|---|
| `weread-transport.ts` | `WereadNodeTransport.headers(url)` 的 Web 分支改：`Cookie: wr_vid=<vid>; wr_skey=<refreshToken>`（用 `refreshToken`，非 `accessToken`）。`wr_rt` 暂不拼（we-mp-rss 枚举显示 `wr_skey=refreshToken` 单独已可通；若续期后服务端下发 `wr_rt`，则由 renewal 流程带上）。保留 `WXKIT_WEREAD_BASE` 的 `isWereadUrl` Node 路由 seam | `weread-transport.test.ts` 新增：Web Cookie 用 `refreshToken`；`isWereadUrl` 的 `WXKIT_WEREAD_BASE` 分支已在 eb8d3e4 覆盖 |

### Task 4：`electron/services/weread-auth.ts` 编排层

| 文件 | 内容 | 关键测试 |
|---|---|---|
| `weread-auth.ts` | `nodeQrHttp()` 简化：不再注入 `WEREAD_VERSION_HEADERS`（Web 端用浏览器 UA `Mozilla/5.0 ... Chrome/120` + `Origin/Referer: https://weread.qq.com`），`getJson`/`postJson` 保留超时 25s。`runWereadLogin(store, deps, hooks)` 重写：`getLoginUid` -> `onQr({uuid, confirmUrl: webConfirmUrl})` -> 轮询 `pollLoginInfo`（`pollIntervalMs` 默认 2000，`pollTimeoutMs` 默认 300s，长轮询单次 70s 不计入间隔；`LOGIN_TIMEOUT` 视为 waiting 继续轮询；402/过期等逻辑按 Web 端 `logicCode` 处理）-> `parseWebLoginResponse` -> `store.write`。`402` 过期换码重入（外层循环）。`wereadCredsStore`/`wereadListUrl`/`makeWereadClient` 不变 | `runWereadLogin` 的 waiting/scanned/confirmed/expired/declined 分支；`LOGIN_TIMEOUT` 不当过期；`onQr` 回调带 `web/confirm` URL |
| `weread-auth.ts` | `wereadListFn`/`wereadCrawlListFn` 不动（已在 Plan B 中正确：`getLatestArticle` + `fetchHtml(cover.url)` 提取 `createTime` + `mid/idx`） | 复用既有测试 |

### Task 5：GUI 接线（小改）

| 文件 | 内容 | 关键测试 |
|---|---|---|
| `src/renderer/hooks/useWereadLoginQr.ts` | `qrDataUrl` 生成逻辑不变，仅 `confirmUrl` 来源从 `open.weixin` 换成 `web/confirm`（`qrcode` 包本地生成 PNG dataURL，無需外网） | hook 单测：`confirmUrl` 含 `weread.qq.com/web/confirm?uid=` |
| `src/renderer/pages/Settings.tsx` / `src/renderer/components/download/AccountMode.tsx` | 文案微调：登录区标题仍「微信读书账号」；`LoginGate` 的 `onLoggedIn` 语义不变 | 手动验收 |

### Task 6：CLI 接线（小改）

| 文件 | 内容 | 关键测试 |
|---|---|---|
| `src/cli/index.ts` | `login` 的终端二维码输出：`confirmUrl` 改为 Web 端 `web/confirm`，`qrcode-terminal` 渲染不变；`auth-status --verify` 真调 `/api/mp/cover`（`weread-list` kind）验证 `wr_skey=refreshToken` 有效性 | `cli-contract.test.ts` 的 `login` 输出含 `weread.qq.com/web/confirm` |

### Task 7：测试与验收

- 单测：`qr-flow.test.ts` 重写为 Web 端、`weread-transport.test.ts` 补 Web Cookie 用 `refreshToken`、`creds-store.test.ts` 补 renewal 新路径、`client.test.ts` 不动（`parseCover` 仍 `reviewId/title`）。
- `npm test` 52+ 文件全绿（当前 471，新增后 475+）；`npm run lint` 0；`npx tsc --noEmit` 0；`npx vite build` 绿。
- e2e：`tests/e2e/gui.e2e.mjs` 的 fixture-seeded 路径（`weread-creds.json` 存 `vid`+`refreshToken`）保持可用；`WXKIT_WEREAD_BASE` mock 仍走 Node 传输（`isWereadUrl` seam 已验证）。如需覆盖真实登录，增加 `WEREAD_LIVE=1` 分支（可选，不阻塞）。
- **真机验收（必做，阻塞发版）**：`npm run dev` -> 设置/下载页扫 Web 端二维码 -> 输入任意文章 URL（`mp.weixin.qq.com/s/...`）-> `mp:crawl` 不再 401、不再弹登录；`subscriptions check-now` 同样不 401。失败时 `errCode -2012` 视为登录态问题，引导重扫。

## 2. 完成定义

- 真机扫码后 `weread.qq.com/api/mp/cover?bookId=MP_WXS_...` 返回 200 且 `reviewId/title` 非空，`mp:crawl`/`subscriptions` 不再 401；
- 旧移动端登录代码（`i.weread`/`wxticket`/`deviceId`/`wereadSignature`）已删除，无残留引用；
- `Cookie: wr_vid; wr_skey=refreshToken` 在 `weread-transport.test.ts` 钉住；
- `npm test`/`lint`/`tsc`/`vite build`/`test:e2e` 全绿；
- 合回 `main`、删分支、devlog 增补后发版。

## 3. 风险与回退

- Web 端 `getLoginInfo` 长轮询 70s 挂起：`nodeQrHttp` 超时设 70s+，`runWereadLogin` 的 `pollTimeoutMs` 300s 内不判过期，`LOGIN_TIMEOUT` 逻辑码视为 waiting（对齐 we-mp-rss）。
- `wr_skey` 短值被 `-2012` 拒：始终用 `refreshToken` 当 `wr_skey`，短值仅作诊断日志，不入 Cookie。
- 旧 `weread-creds.json`（含 `deviceId`）兼容：`readWereadCredsFile` 宽松解析，缺 `refreshToken` 时视为无效凭据，引导重扫。

## 4. 实施结果与最终边界（2026-08-27 当日收口）

已落地（提交 `3f43749`→`afbdfa4` 链）：
1. 登录换 Web 端协议后连修三处真机问题：`webLoginVid` 为数字、会话 Cookie 全量落盘、
   `reviewId` token 中 `~↔_` 与 mp 短链不一致时自动换写重取。
2. **网络栈指纹分级**（当日核心发现）：微信读书按请求发起端给会话分级——
   系统 Chrome 可全量列表；Electron 自带栈与 Node undici 即使凭据正确也恒 `-2041`。
   同一 Cookie 双栈对照 + Playwright 系统复用均验证。据此把登录与业务统一迁入
   Electron 分区栈（`weread-net.ts`，persist:weread），并以「列表失败即回退 cover 单篇」保订阅。
3. 列表分页实现完备（每页 20，上限 200 页），接口一旦放开即自动获得批量能力。

**最终边界**：「按公众号下载历史 N>1 篇」在纯 Electron/Node 架构内无解，
详见 AGENTS.md 关键约束「网络栈指纹分级」。增量订阅（cover → 水位 → 自动下载）
不受影响，为 v0.10.0 实际交付形态。历史回补如需突破，候选路径：系统 Chrome CDP
自动化 spike 或等待官方放开——均需单独立项决策。

### 追记（spike 终局）：「网络栈指纹」归因被否定

真 Chrome 窗口全新扫码登录（renewal 正常轮换、身份健康）后列表仍 `-2041`
（`scripts/spike-weread-login-chrome.mjs`，PASS/FAIL 自判定）。服务端按
**账号+端点**维度封禁列表，与客户端栈无关；此前系统 Chrome 成功的一次为
账号限制窗口期巧合。边界结论不变：历史批量无解，增量订阅为交付形态。
