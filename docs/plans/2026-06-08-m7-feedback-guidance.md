# M7 · 反馈引导：频控可见 + 失败有指引（+ R3 取消/完成回到配置）

> 对应 PRD-v0.2.0 R5（频控可见 + 失败引导）与 R3 残留缺口。
> R3 的「换一个」按安哥指示保持现状不优化；本里程碑只补 R3 验收里仍缺的「取消/完成后回到配置」。

## 为什么（对用户的影响）
- **频控可见**：公众号列表阶段命中频控时，core 已在静默退避 30/60/90s，但 GUI 仍显示「正在爬取 0/0」，看起来像卡死。要让用户看见「在等、还要等多久、第几次」，而不是怀疑死机。
- **失败引导**：现在把原始报错（`fetch timeout after 20000ms: ...`、`invalid or unavailable article ...`、`AUTH_REQUIRED`）直接甩给用户，无法行动。要归一为「人话标题 + 下一步建议」，原始信息折叠备查。
- **R3 回到配置**：取消或完成后，进度区占据视图、配置区不可见，无法「改条件再下一批」。补一个「返回配置」让已选号/范围/格式不丢地回到配置态。

## 现状锚点（已读代码）
- 退避逻辑：`src/core/mp-crawl.ts` 列表阶段 `for(attempt) … catch MpRateLimited → sleep(30000*(attempt+1)) → continue`，**无任何上报**。
- 进度事件：IPC `mp:crawl:progress`，`{kind:'listed'|'item'|'done'}`（`electron/ipc.ts:114-122`）；渲染端 `AccountMode.tsx` 消费，`CrawlProgress.tsx` 展示。
- 错误现状：`AccountMode.start` catch → `message.error('爬取出错：'+msg)`；`UrlMode.start` catch → `message.error('下载出错：'+msg)`；失败行 tooltip 直接显示 `r.error`。
- 错误源文案：`MpRateLimited.code='RATE_LIMITED'`、`MpAuthExpired.code='AUTH_REQUIRED'`、`MpApiError.code='MP_API_ERROR'`；`fetch-html.ts` 抛 `fetch timeout after 20000ms: <url>`；`download-article.ts:32` 抛 `invalid or unavailable article (no title parsed): <url>`；无 session 时 ipc 抛 `AUTH_REQUIRED`。

---

## Batch 1 · R5b 失败话术（core，纯逻辑 TDD）
新增 `src/core/error-explain.ts`：纯函数 `explainError(err: unknown): ExplainedError`，被 GUI 与（未来）CLI 共享，**不 import 任何 UI**。

```ts
// src/core/error-explain.ts
export interface ExplainedError { title: string; hint: string; raw: string }

/** 把原始错误归一为「人话标题 + 下一步建议」，原始信息保留在 raw 折叠备查。 */
export function explainError(err: unknown): ExplainedError {
  const raw = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string })?.code
  const m = raw.toLowerCase()
  const has = (...ks: string[]) => ks.some((k) => m.includes(k))

  if (code === 'RATE_LIMITED' || has('200013', '频率限制'))
    return { title: '微信访问太频繁', hint: '已自动退避重试仍未成功，请等几分钟再下一批。', raw }
  if (code === 'AUTH_REQUIRED' || has('auth_required', '200040', '登录态'))
    return { title: '登录已过期', hint: '请重新登录公众号后台后再试。', raw }
  if (has('timeout'))
    return { title: '网络超时', hint: '请检查网络（含代理设置）后重试。', raw }
  if (has('fetch failed', 'enotfound', 'econnrefused', 'econnreset', 'etimedout', 'network', 'getaddrinfo'))
    return { title: '网络异常', hint: '请检查网络连接后重试。', raw }
  if (has('no title parsed', 'invalid or unavailable article'))
    return { title: '文章无法访问', hint: '可能已被删除或设为私密，换一篇再试。', raw }
  if (code === 'MP_API_ERROR')
    return { title: '微信接口出错', hint: '请稍后重试。', raw }
  return { title: '下载失败', hint: '请重试；若反复失败可向我反馈。', raw }
}
```

测试 `tests/core/error-explain.test.ts`：逐类断言 title/hint，并断言 `raw` 始终保留原文（含未知错误兜底）。用真实错误实例（`new MpRateLimited(...)` 等）+ 字符串消息两路覆盖。

## Batch 2 · R5a 频控可见（core）
`CrawlDeps` 增 `onBackoff?: (ev: { attempt: number; waitMs: number; reason: 'rate-limit' }) => void`。
`crawlAccount` 列表阶段重试循环里，sleep 前上报：

```ts
if (e instanceof MpRateLimited && attempt < 3) {
  const waitMs = 30000 * (attempt + 1)
  deps.onBackoff?.({ attempt: attempt + 1, waitMs, reason: 'rate-limit' })
  await sleep(waitMs); continue
}
```

测试 `tests/core/mp-crawl.test.ts` 增一例：注入 `listFn` 头两次抛 `MpRateLimited`、第三次成功 + 假 `sleep`，断言 `onBackoff` 被调用两次且 `attempt` 为 1、2、`waitMs` 为 30000、60000；最终 summary 正常。

## Batch 3 · 接线（electron + preload + api 类型）
- `electron/ipc.ts` crawl handler 增 `onBackoff: (ev) => send({ kind: 'backoff', ...ev })`。
- `src/renderer/api.ts` `CrawlEvent` 联合增 `| { kind: 'backoff'; attempt: number; waitMs: number; reason: 'rate-limit' }`。
- preload 无需改（透传）；`npx tsc` 锁类型。

## Batch 4 · 渲染（R5 UI）
- `CrawlProgress.tsx`：增 `backoff?: { attempt: number; until: number } | null` prop，渲染一条朱砂底「退避横幅」：
  「微信访问太频繁，已自动退避 · 约 {N} 秒后重试（第 {attempt} 次）」，N 由 `until - now` 客户端每秒倒数。列表阶段（rows 空）也要显示，所以横幅独立于行列表之上。
- `AccountMode.tsx`：
  - 进度回调处理 `kind==='backoff'`：`setBackoff({ attempt: ev.attempt, until: Date.now() + ev.waitMs })`；收到 `listed`/`item`/`done` 时清空 backoff。
  - `start` catch 用 `explainError`：`const ex = explainError(e); message.error(ex.title + '：' + ex.hint)`；保留 AUTH_REQUIRED → 切登录门的分支判断（改为按 `explainError` 的 code 或 raw 判定）。
  - 失败行：把 `explainError(row.error).title` 作为徽章/tooltip 主文案，原始 raw 放 `title` 属性折叠。
- `UrlMode.tsx`：catch 同样改用 `explainError`。
- 样式：`index.css` 加 `.backoff-banner`（朱砂描边 + 柔光，非报错红，强调「在等而非出错」）。

## Batch 5 · R3 取消/完成回到配置
`CrawlProgress` 在 `!running` 时，进度头部右侧除 `done/total` 外加一个「返回配置」按钮，点了调用新 prop `onBack`。`AccountMode` 的 `onBack` = `() => { setRows([]); setBackoff(null) }` → 因 `selected` 仍在、`running` false、`rows` 空，配置卡自动重现（状态不丢）。这同时满足「取消后回到配置」与「完成后改条件再下一批」。

## Batch 6 · 验证 + 文档
- `npm test`（新增 error-explain、mp-crawl backoff 例全绿）、`npx tsc --noEmit`、`npm run lint`。
- `npm run test:e2e`（真实 session 跑公众号链路，断言不回归）。
- **真实 session 截图**驱动到「按公众号下载」配置态 + 触发一次失败看话术（见 memory：必须真实数据态，非隔离沙箱）。
- 更新 `docs/PRD-v0.2.0.md`（标注 M7 已实现点）、`ROADMAP.md`（M7 ✅）、`docs/devlog/wx-kit-vibe-coding.md`（增补 M7 复盘：静默退避的可见化、错误话术归一为何放 core）。
- 验证通过 → 合回 main 删分支，commit（push 仍等安哥）。
