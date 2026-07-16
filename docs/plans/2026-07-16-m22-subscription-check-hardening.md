# M22 · 订阅检查加固:防重入 + 失败明细 + 翻到水位为止（v0.5.4）

> 需求/验收见 `docs/PRD-v0.5.4.md`。分支 `feat/m22-subscription-check-hardening`。TDD:纯逻辑先写测试。

## 步骤

### 1. R3 · `listArticlesSince`（mp-client,TDD）

`src/core/mp-client.ts` 新增(复用 `fetchPage`):

```ts
/** 订阅检查专用:从最新往回翻,看见 ≤sinceTs 的已读文章即止;封顶 cap 篇。平时 1 页(1 次请求)即止。 */
export async function listArticlesSince(
  mpFetch: MpFetch, token: string, fakeid: string, sinceTs: number, opts: ListOpts = {}, cap = 20,
): Promise<ArticleRef[]> {
  // 循环:fetchPage → push → 任一条 ≤ sinceTs 则 break;out.length ≥ cap 则 break;begin += pageLen;页间 sleep(randMs(1000,3000))
}
```

测试(`tests/core/mp-client.test.ts` 追加):首页含已读 → 1 次请求;整页全新 → 翻第 2 页;封顶 20;空列表;total 耗尽。

### 2. R3 · check-subscriptions 换接缝

`listFn` 签名从 `(mpFetch, token, fakeid, RECENT, {sleep})` 改为 `(mpFetch, token, fakeid, watermark, {sleep})`,默认实现 `listArticlesSince`。删除 `RECENT` 常量。返回值可含旧文章,`> watermark` 过滤保留在 checkSubscriptions(既有测试语义不变,仅改 stub 签名)。

### 3. R2 · CheckLogEntry 失败明细

- `src/core/subscriptions.ts`:`CheckLogEntry` 加 `failures?: { nickname: string; error: string }[]`;`formatCheckLogLine` 有明细时追加 ` [昵称: 错误; …]`。
- `electron/services/subscription-check.ts`:收集 `!r.ok` 的 `{nickname, error}` 进日志与 `RunCheckResult`。
- `src/cli/index.ts` check-now 的 outJson 带 `failures`。
- 测试:formatCheckLogLine 明细行;subscription-check 失败明细收集(含 nickname 映射)。

### 4. R1 · 防重入

- `electron/services/subscription-scheduler.ts`:`private running` 守卫,tick 时在跑则跳过;`finally` 复位。新增 `tests/electron/subscription-scheduler.test.ts`(fake timers:runCheck 挂起期间多次 tick 只触发一次;结束后下一时段照常)。
- `electron/ipc.ts` `runSubscriptionCheck`:module 级 `checkInFlight` promise,在跑则返回同一 promise(手动/自动并入)。

### 5. R2 · 订阅页弹窗

`Subscriptions.tsx` 检查记录行:`e.failed > 0 && e.failures?.length` 时「失败 x」渲染为 `<a>`,点击 `Modal.info` 列出 `昵称 — 错误`;否则原纯文本。

### 6. 验证

`npm test`、lint、tsc、`npm run test:e2e`;GUI 真机:隔离 userData + seed 带 failures 的 checkLog,截图弹窗。

### 7. 发版（R4）

按发版规约:bump → releases 说明 → 打包 → 打包态验证 → README/ROADMAP/devlog §32 → 合 main、tag、Release。
