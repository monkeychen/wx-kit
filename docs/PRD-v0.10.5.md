# wx-kit v0.10.5 产品需求文档（迭代 PRD）

> 修复版（两项，均源自安哥 2026-09-08/09 实测）。当前进度见 `ROADMAP.md`，验收以本文第 4 节为准。

## 1. 一句话定义

**失败必须保留失败的样子：登录态失效不能伪装成「没有新文章」，问题解决后提示不能赖着不走。**

## 2. 需求清单

### R1 · 登录态失效不得伪装成「没有新文章」

**用户目标**：微信读书登录态过期后，检查订阅要么如实报「需重新登录」，要么引导重登——绝不能
报「没有新文章」让用户误以为没有更新（安哥实测：腾讯云开发者、刘备教授当天有新文章，检查
却报无）。

**根因**（三环相扣，2026-09-08 排查实录）：`wr_skey` 过期后 cover 接口 401；传输层抛的是
带 `status` 的通用 Error（无人识别为鉴权失效）；cover 回退函数 `catch(() => null)` 把它吞成
空列表——上层把空解读为「cover 仍指已读文章」→「没有新文章」，`authExpired` 恒 false。

**方案**：

- 传输层 401/403 抛 `MpAuthExpired`（鉴权失效专用错误，`checkSubscriptions` 已有对它的
  整体中止分支：`auth-expired` 落盘 + 页面 Alert + CLI `note`）。
- cover 回退不吞鉴权错误：`MpAuthExpired` 上抛，其余错误保持既有「回退为空」语义。

### R2 · 重新登录后，「需重新登录」提示要消失

**用户目标**：行动完成，反馈就消失。重登成功回到订阅页，顶部黄色 Alert 不应继续挂着。

**方案**：订阅页加载时用 `mpSessionInfo()` 的实时凭据状态修正「上次检查」的旧结论——
`s.authExpired && live.loggedIn !== true` 才显示。若重登后凭据仍无效（残留旧凭据），下次检查
报 `auth-expired` 时提示如实回来。

### R3 · `check-now --accounts` 按身份归一匹配（排查 R1 时撞见的独立 bug）

**用户目标**：`subscription list` 输出的 fakeid（归一后的 `MP_WXS_` 形态）传给
`check-now --accounts` 必须生效——此前字面比对磁盘里的 base64 形态，永远 `accounts:0`
（skill 指导 agent 这么用，必踩）。

**方案**：`runSubscriptionCheck` 的 fakeids 过滤用 `normalizeAccountKey` 双向归一比对。

## 3.5 非目标

- 不改登录态续期机制（`renewal` 轻量探测维持现状，有效性由业务请求裁决）。
- 不做登录态过期的主动探测/通知（检查与用户动作时的如实报错已覆盖）。

## 4. 验收清单（逐条）

- [x] 传输层 401 抛 `MpAuthExpired`（单测：`toBeInstanceOf`）。
- [x] cover 回退：鉴权失效上抛、非鉴权错误仍回退为空（单测两分支）。
- [x] 登录态失效时检查：`authExpired: true`、落 `note: 'auth-expired'`、GUI 顶部 Alert（链路由
      `checkSubscriptions` 既有分支承接，单测钉住传输层与回退层两环）。
- [x] `check-now --accounts` 传 `list` 输出的 `MP_WXS_` 形态可命中磁盘 base64 形态账号（单测）。
- [x] 重登后回订阅页：Alert 消失（实时凭据判定）；凭据无效时下次检查提示如实回来（逻辑闭环）。
- [x] `npm test`、`npm run lint`、`npx tsc --noEmit`、GUI e2e 全绿（572 项单测含 5 条新增）。
