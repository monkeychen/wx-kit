# M3 实现计划 — 扫码登录 + 公众号批量爬取（CLI 优先）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 wx-kit 能扫码登录 mp.weixin.qq.com 后台、按公众号批量爬取图文并复用 M1 管线落盘，全部经 CLI 暴露给 AI agent。

**Architecture:** 延续 core/electron 分层——electron 依赖收进「登录」(`mp-auth`) 与「发请求」(`mp-fetch`) 两个薄适配器；爬取发现 (`mp-client`) 与编排 (`mp-crawl`) 是 UI 无关纯逻辑，注入 `mpFetch` 即可单测；落盘 100% 复用 M1 的 `downloadArticle` + `DownloadQueue` + `articleId` 去重。

**Tech Stack:** TypeScript、Electron 31（`BrowserWindow`+`session.cookies` 取代 Playwright）、axios、commander、vitest。

**设计依据：** `docs/superpowers/specs/2026-06-07-m3-login-crawl-design.md`（方案已与安哥对齐：CLI 优先、存 cookie 无头发请求、延迟默认 翻页 1–3s/下载 2–5s、退避 30s×3、`crawl` 歧义报错附候选、`auth-status` 默认真探测）。

> ⚠️ **接口事实来自原型（2026-02 抓取），Task 1 是活体验证 gate：接口若已变，先在此暴露、再继续。**

---

## File Structure

| 文件 | 层 | 职责 |
|---|---|---|
| `src/core/mp-types.ts` | 纯 | 共享类型：`MpSession / MpFetch / MpAccount / ArticleRef / CrawlRange / CrawlSummary` |
| `src/core/mp-errors.ts` | 纯 | `MpRateLimited / MpAuthExpired / MpApiError` |
| `src/core/mp-client.ts` | 纯 | `searchAccount` / `listArticles` + `checkRet` + `sleep/randMs` |
| `src/core/mp-crawl.ts` | 纯 | `crawlAccount`：列 URL → 退避 → 复用 `DownloadQueue` 串行落盘 |
| `electron/services/mp-fetch.ts` | 主进程 | `makeMpFetch(session)`：axios GET 带 cookie/UA/Referer |
| `electron/services/mp-auth.ts` | 主进程 | `login()` 开窗扫码、`getSession()` / `clearSession()` |
| `src/cli/index.ts` | CLI | 新增 `login / auth-status / search / crawl / library list` |
| `tests/core/mp-client.test.ts` | 测试 | searchAccount/listArticles/ret 码 |
| `tests/core/mp-crawl.test.ts` | 测试 | 串行/去重/失败不中断/退避 |
| `tests/cli/cli-contract.test.ts` | 测试 | AUTH_REQUIRED 输出契约 |

`mp-session.json` 落 `userData`，**不进文章库、不进 git**（加入 `.gitignore` 见 Task 8）。

---

## Task 1: 活体验证 spike（登录 + 一次搜号）— 手动 gate

**Files:**
- Create: `electron/services/mp-auth.ts`（仅 `login()`，后续 Task 8 补全）
- Create: `electron/services/mp-fetch.ts`
- Create: `src/core/mp-types.ts`
- Create: `scripts/m3-spike.mjs`（一次性验证脚本，验证后删）

> 本任务**无自动化测试**——它的目的就是让安哥扫一次码、用肉眼确认 2026-06 接口仍有效。产出的 `mp-auth.login` / `mp-fetch` 是后续要复用的真实代码。

- [ ] **Step 1: 写共享类型 `src/core/mp-types.ts`**

```ts
// src/core/mp-types.ts
export interface MpSession {
  token: string
  cookies: { name: string; value: string }[]
  timestamp: number
}

export interface MpJson {
  base_resp?: { ret: number; err_msg?: string }
  [k: string]: unknown
}

/** 唯一外部副作用入口：发一个带鉴权的 GET，返回解析后的 JSON。纯逻辑只依赖它。 */
export type MpFetch = (endpoint: string, params: Record<string, string>) => Promise<MpJson>

export interface MpAccount { fakeid: string; nickname: string; alias: string; signature: string }

/** 列表阶段对一篇文章的最小描述。下载会重新解析文章页拿全量元信息。 */
export interface ArticleRef { url: string; title: string; createTime: number } // createTime: unix 秒

export type CrawlRange = { count: number } | { from: string; to: string }

export interface CrawlSummary {
  ok: boolean
  fakeid: string
  listed: number
  total: number
  succeeded: number
  failed: number
  skipped: number
  items: import('./types').DownloadItemResult[]
}
```

- [ ] **Step 2: 写生产用请求适配器 `electron/services/mp-fetch.ts`**

```ts
// electron/services/mp-fetch.ts
import axios from 'axios'
import type { MpFetch, MpSession, MpJson } from '../../src/core/mp-types'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** 把一次登录得到的 session 固化进闭包，返回带 cookie 的 mpFetch。 */
export function makeMpFetch(session: MpSession): MpFetch {
  const cookie = session.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  return async (endpoint, params) => {
    const res = await axios.get(endpoint, {
      params,
      timeout: 20000,
      headers: { 'User-Agent': UA, Referer: 'https://mp.weixin.qq.com/', Cookie: cookie },
    })
    return res.data as MpJson
  }
}
```

- [ ] **Step 3: 写登录服务 `electron/services/mp-auth.ts`（仅 login）**

```ts
// electron/services/mp-auth.ts
import { BrowserWindow } from 'electron'
import type { MpSession } from '../../src/core/mp-types'

/** 开窗扫码登录 mp 后台，捕获 token + cookies。用户未登录即关窗 → 抛 CANCELLED。 */
export async function login(): Promise<MpSession> {
  const win = new BrowserWindow({
    width: 480, height: 640, title: '扫码登录公众号后台',
    webPreferences: { partition: 'persist:mpweixin' },
  })
  return new Promise<MpSession>((resolve, reject) => {
    let done = false
    const onNav = async () => {
      const url = win.webContents.getURL()
      const m = /[?&]token=(\d+)/.exec(url)
      if (url.includes('/cgi-bin/home') && m) {
        done = true
        const cookies = (await win.webContents.session.cookies.get({ url: 'https://mp.weixin.qq.com' }))
          .map((c) => ({ name: c.name, value: c.value }))
        const session: MpSession = { token: m[1], cookies, timestamp: Date.now() }
        win.removeListener('closed', onClosed)
        win.destroy()
        resolve(session)
      }
    }
    const onClosed = () => { if (!done) reject(new Error('CANCELLED')) }
    win.webContents.on('did-navigate', onNav)
    win.webContents.on('did-navigate-in-page', onNav)
    win.on('closed', onClosed)
    win.loadURL('https://mp.weixin.qq.com/')
  })
}
```

- [ ] **Step 4: 写一次性 spike 脚本 `scripts/m3-spike.mjs`**

```js
// scripts/m3-spike.mjs — 一次性：扫码登录 + 调一次 searchbiz，打印原始返回。验证后删除。
import { app } from 'electron'
import { login } from '../dist-electron/services/mp-auth.js'
import { makeMpFetch } from '../dist-electron/services/mp-fetch.js'

app.on('window-all-closed', () => {})
await app.whenReady()
try {
  console.error('[spike] 请在弹出的窗口扫码登录你的公众号后台…')
  const session = await login()
  console.error('[spike] 登录成功 token=', session.token, 'cookies=', session.cookies.length)
  const mpFetch = makeMpFetch(session)
  const json = await mpFetch('https://mp.weixin.qq.com/cgi-bin/searchbiz', {
    action: 'search_biz', token: session.token, lang: 'zh_CN', f: 'json', ajax: '1',
    random: String(Math.random()), query: '腾讯', begin: '0', count: '5',
  })
  console.error('[spike] searchbiz base_resp=', JSON.stringify(json.base_resp))
  console.error('[spike] 首个候选=', JSON.stringify(json.list?.[0] ?? null))
} catch (e) {
  console.error('[spike] 失败：', e.message)
} finally {
  app.exit(0)
}
```

- [ ] **Step 5: 构建并运行 spike（安哥扫码）**

Run: `npx vite build && npx electron scripts/m3-spike.mjs`
Expected（安哥扫码后）: stderr 打印 `登录成功 token=...`、`searchbiz base_resp={"ret":0,...}`、`首个候选={"fakeid":...,"nickname":"腾讯",...}`。

**GATE：** 若 `base_resp.ret` 非 0 或拿不到 token/cookies → 接口或登录流程已变，**停下来分析、修正 Task 1 代码后再继续**，不要往下建。若候选字段名与 `mp-types.ts` 的 `MpAccount`（fakeid/nickname/alias）不符，记录真实字段名并在 Task 3 校正。

- [ ] **Step 6: 删除 spike 脚本并提交**

```bash
rm scripts/m3-spike.mjs
git add src/core/mp-types.ts electron/services/mp-fetch.ts electron/services/mp-auth.ts
git commit -m "feat(m3): mp-auth login + mp-fetch transport (live-verified)"
```

---

## Task 2: 错误类型 `mp-errors.ts`

**Files:**
- Create: `src/core/mp-errors.ts`

- [ ] **Step 1: 写错误类**

```ts
// src/core/mp-errors.ts
/** ret=200013：频控。调用方应退避降速。 */
export class MpRateLimited extends Error { readonly code = 'RATE_LIMITED' }
/** ret=200040：登录态失效。调用方应引导重新登录（AUTH_REQUIRED）。 */
export class MpAuthExpired extends Error { readonly code = 'AUTH_REQUIRED' }
/** 其它非 0 ret。 */
export class MpApiError extends Error {
  readonly code = 'MP_API_ERROR'
  constructor(public ret: number, message: string) { super(message) }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/core/mp-errors.ts
git commit -m "feat(m3): mp error types"
```

---

## Task 3: `mp-client.searchAccount` + `checkRet`

**Files:**
- Create: `src/core/mp-client.ts`
- Test: `tests/core/mp-client.test.ts`

- [ ] **Step 1: 写失败测试（searchAccount 映射 + ret 码）**

```ts
// tests/core/mp-client.test.ts
import { describe, it, expect } from 'vitest'
import { searchAccount } from '../../src/core/mp-client'
import { MpAuthExpired, MpRateLimited, MpApiError } from '../../src/core/mp-errors'
import type { MpFetch } from '../../src/core/mp-types'

const fakeFetch = (json: unknown): MpFetch => async () => json as never

describe('searchAccount', () => {
  it('maps the candidate list', async () => {
    const mpFetch = fakeFetch({
      base_resp: { ret: 0 },
      list: [{ fakeid: 'FID1', nickname: '猫笔刀', alias: 'maobid', signature: 'sig' }],
    })
    const out = await searchAccount(mpFetch, 'TOKEN', '猫笔刀')
    expect(out).toEqual([{ fakeid: 'FID1', nickname: '猫笔刀', alias: 'maobid', signature: 'sig' }])
  })

  it('throws MpAuthExpired on ret 200040', async () => {
    await expect(searchAccount(fakeFetch({ base_resp: { ret: 200040 } }), 'T', 'x'))
      .rejects.toBeInstanceOf(MpAuthExpired)
  })

  it('throws MpRateLimited on ret 200013', async () => {
    await expect(searchAccount(fakeFetch({ base_resp: { ret: 200013 } }), 'T', 'x'))
      .rejects.toBeInstanceOf(MpRateLimited)
  })

  it('throws MpApiError on other non-zero ret', async () => {
    await expect(searchAccount(fakeFetch({ base_resp: { ret: 99, err_msg: 'boom' } }), 'T', 'x'))
      .rejects.toBeInstanceOf(MpApiError)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/mp-client.test.ts`
Expected: FAIL（`searchAccount` 未定义）。

- [ ] **Step 3: 写实现**

```ts
// src/core/mp-client.ts
import type { MpFetch, MpAccount, ArticleRef, CrawlRange, MpJson } from './mp-types'
import { MpRateLimited, MpAuthExpired, MpApiError } from './mp-errors'

const SEARCHBIZ = 'https://mp.weixin.qq.com/cgi-bin/searchbiz'
const APPMSG = 'https://mp.weixin.qq.com/cgi-bin/appmsg'
const PAGE = 20

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
export const randMs = (min: number, max: number): number => Math.floor(min + Math.random() * (max - min))

/** 检查 base_resp.ret，把已知风控/失效码翻译成具体异常。 */
export function checkRet(json: MpJson): void {
  const ret = json.base_resp?.ret ?? 0
  if (ret === 0) return
  if (ret === 200013) throw new MpRateLimited('微信频率限制（200013）')
  if (ret === 200040) throw new MpAuthExpired('登录态失效（200040）')
  throw new MpApiError(ret, json.base_resp?.err_msg ?? `mp api ret=${ret}`)
}

export async function searchAccount(mpFetch: MpFetch, token: string, name: string): Promise<MpAccount[]> {
  const json = await mpFetch(SEARCHBIZ, {
    action: 'search_biz', token, lang: 'zh_CN', f: 'json', ajax: '1',
    random: String(Math.random()), query: name, begin: '0', count: '5',
  })
  checkRet(json)
  const list = (json.list as Record<string, unknown>[]) ?? []
  return list.map((a) => ({
    fakeid: String(a.fakeid ?? ''),
    nickname: String(a.nickname ?? ''),
    alias: String(a.alias ?? ''),
    signature: String(a.signature ?? ''),
  }))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/mp-client.test.ts`
Expected: PASS（4 个）。

- [ ] **Step 5: 提交**

```bash
git add src/core/mp-client.ts tests/core/mp-client.test.ts
git commit -m "feat(m3): mp-client.searchAccount + ret-code mapping"
```

---

## Task 4: `mp-client.listArticles`（数量模式 + 翻页）

**Files:**
- Modify: `src/core/mp-client.ts`
- Test: `tests/core/mp-client.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

```ts
// tests/core/mp-client.test.ts —— 追加
import { listArticles } from '../../src/core/mp-client'

// 按 begin 返回分页的假 appmsg
function pagedFetch(pages: { url: string; title: string; create_time: number }[][], total: number): MpFetch {
  return async (_endpoint, params) => {
    const begin = Number(params.begin)
    const page = pages[begin / 20] ?? []
    return { base_resp: { ret: 0 }, app_msg_cnt: total, app_msg_list: page } as never
  }
}
const noSleep = { sleep: async () => {} }

describe('listArticles count mode', () => {
  it('accumulates across pages and truncates to count', async () => {
    const mk = (n: number) => ({ url: `u${n}`, title: `t${n}`, create_time: 1700000000 - n })
    const pages = [[mk(0), mk(1)], [mk(2), mk(3)]] // 2 页各 2 篇
    const refs = await listArticles(pagedFetch(pages, 4), 'T', 'FID', { count: 3 }, noSleep)
    expect(refs.map((r) => r.url)).toEqual(['u0', 'u1', 'u2'])
  })

  it('stops when list is exhausted before reaching count', async () => {
    const mk = (n: number) => ({ url: `u${n}`, title: `t${n}`, create_time: 1700000000 - n })
    const refs = await listArticles(pagedFetch([[mk(0)]], 1), 'T', 'FID', { count: 50 }, noSleep)
    expect(refs.map((r) => r.url)).toEqual(['u0'])
  })

  it('skips items without a link', async () => {
    const fetch: MpFetch = async () => ({
      base_resp: { ret: 0 }, app_msg_cnt: 2,
      app_msg_list: [{ title: 'no-link', create_time: 1 }, { link: 'u1', title: 't', create_time: 2 }],
    }) as never
    const refs = await listArticles(fetch, 'T', 'FID', { count: 10 }, noSleep)
    expect(refs.map((r) => r.url)).toEqual(['u1'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/core/mp-client.test.ts`
Expected: FAIL（`listArticles` 未定义）。

- [ ] **Step 3: 追加实现到 `mp-client.ts`**

```ts
// src/core/mp-client.ts —— 追加
export interface ListOpts { sleep?: (ms: number) => Promise<void> }

async function fetchPage(
  mpFetch: MpFetch, token: string, fakeid: string, begin: number,
): Promise<{ items: ArticleRef[]; total: number }> {
  const json = await mpFetch(APPMSG, {
    action: 'list_ex', begin: String(begin), count: String(PAGE), fakeid,
    token, lang: 'zh_CN', f: 'json', ajax: '1', type: '9', query: '',
  })
  checkRet(json)
  const raw = (json.app_msg_list as Record<string, unknown>[]) ?? []
  const items: ArticleRef[] = raw
    .filter((i) => i.link)
    .map((i) => ({ url: String(i.link), title: String(i.title ?? ''), createTime: Number(i.create_time ?? 0) }))
  return { items, total: Number(json.app_msg_cnt ?? 0) }
}

export async function listArticles(
  mpFetch: MpFetch, token: string, fakeid: string, range: CrawlRange, opts: ListOpts = {},
): Promise<ArticleRef[]> {
  const sleepFn = opts.sleep ?? sleep
  const out: ArticleRef[] = []
  let begin = 0
  for (;;) {
    if (begin > 0) await sleepFn(randMs(1000, 3000))
    const { items, total } = await fetchPage(mpFetch, token, fakeid, begin)
    if (!items.length) break
    if ('count' in range) {
      out.push(...items)
      if (out.length >= range.count) return out.slice(0, range.count)
    } else {
      const fromTs = Date.parse(`${range.from}T00:00:00`) / 1000
      const toTs = Date.parse(`${range.to}T23:59:59`) / 1000
      for (const it of items) {
        if (it.createTime > toTs) continue
        if (it.createTime < fromTs) return out
        out.push(it)
      }
    }
    begin += PAGE
    if (begin >= total) break
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/core/mp-client.test.ts`
Expected: PASS（含新增 3 个）。

- [ ] **Step 5: 提交**

```bash
git add src/core/mp-client.ts tests/core/mp-client.test.ts
git commit -m "feat(m3): listArticles count mode with pagination"
```

---

## Task 5: `listArticles` 日期模式

**Files:**
- Test: `tests/core/mp-client.test.ts`（追加）

> 实现已在 Task 4 写好（`from/to` 分支）。本任务用测试锁定日期窗口语义（最新在前：> to 跳过、< from 截止）。

- [ ] **Step 1: 追加失败测试**

```ts
// tests/core/mp-client.test.ts —— 追加
describe('listArticles date mode', () => {
  // 2026-02-27, 26, 25, 24（unix 秒，UTC 正午避免时区翻日）
  const ts = (d: string) => Date.parse(`${d}T12:00:00`) / 1000
  const item = (d: string) => ({ url: `u${d}`, title: d, create_time: ts(d) })

  it('keeps only items within [from,to], newest-first', async () => {
    const fetch: MpFetch = async () => ({
      base_resp: { ret: 0 }, app_msg_cnt: 4,
      app_msg_list: [item('2026-02-27'), item('2026-02-26'), item('2026-02-25'), item('2026-02-24')],
    }) as never
    const refs = await listArticles(fetch, 'T', 'FID', { from: '2026-02-25', to: '2026-02-26' }, { sleep: async () => {} })
    expect(refs.map((r) => r.title)).toEqual(['2026-02-26', '2026-02-25'])
  })
})
```

- [ ] **Step 2: 运行确认通过（实现已存在）**

Run: `npx vitest run tests/core/mp-client.test.ts`
Expected: PASS。若 FAIL，检查 Task 4 的 `from/to` 分支边界（`>toTs` continue、`<fromTs` return）。

- [ ] **Step 3: 提交**

```bash
git add tests/core/mp-client.test.ts
git commit -m "test(m3): listArticles date-range window semantics"
```

---

## Task 6: `mp-crawl.crawlAccount`（编排 + 退避 + 复用 DownloadQueue）

**Files:**
- Create: `src/core/mp-crawl.ts`
- Test: `tests/core/mp-crawl.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/core/mp-crawl.test.ts
import { describe, it, expect, vi } from 'vitest'
import { crawlAccount } from '../../src/core/mp-crawl'
import { MpRateLimited } from '../../src/core/mp-errors'
import type { ArticleRef } from '../../src/core/mp-types'
import type { DownloadItemResult } from '../../src/core/types'

const refs = (urls: string[]): ArticleRef[] => urls.map((u) => ({ url: u, title: u, createTime: 0 }))
const noSleep = async () => {}

describe('crawlAccount', () => {
  it('downloads serially and rolls up a summary', async () => {
    const order: string[] = []
    const downloadOne = async (url: string): Promise<DownloadItemResult> => { order.push(url); return { url, ok: true, id: url } }
    const out = await crawlAccount('FID', { count: 3 }, {
      listFn: async () => refs(['a', 'b', 'c']),
      mpFetch: (async () => ({})) as never, token: 'T', downloadOne, sleep: noSleep,
    })
    expect(order).toEqual(['a', 'b', 'c'])
    expect(out).toMatchObject({ ok: true, fakeid: 'FID', listed: 3, total: 3, succeeded: 3, failed: 0, skipped: 0 })
  })

  it('continues past a single failure and counts skips', async () => {
    const downloadOne = async (url: string): Promise<DownloadItemResult> => {
      if (url === 'b') throw new Error('boom')
      if (url === 'c') return { url, ok: true, skipped: true, id: url }
      return { url, ok: true, id: url }
    }
    const out = await crawlAccount('FID', { count: 3 }, {
      listFn: async () => refs(['a', 'b', 'c']),
      mpFetch: (async () => ({})) as never, token: 'T', downloadOne, sleep: noSleep,
    })
    expect(out).toMatchObject({ succeeded: 1, failed: 1, skipped: 1 })
  })

  it('backs off and retries when listing is rate-limited', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    const listFn = async () => { if (calls++ === 0) throw new MpRateLimited('rl'); return refs(['a']) }
    const out = await crawlAccount('FID', { count: 1 }, {
      listFn, mpFetch: (async () => ({})) as never, token: 'T',
      downloadOne: async (url) => ({ url, ok: true, id: url }), sleep,
    })
    expect(out.succeeded).toBe(1)
    expect(sleep).toHaveBeenCalledWith(30000) // 第一次退避 30s
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/core/mp-crawl.test.ts`
Expected: FAIL（`crawlAccount` 未定义）。

- [ ] **Step 3: 写实现**

```ts
// src/core/mp-crawl.ts
import { DownloadQueue, type OnProgress } from './download-queue'
import { listArticles as listArticlesImpl, sleep as sleepImpl, randMs } from './mp-client'
import { MpRateLimited } from './mp-errors'
import type { MpFetch, ArticleRef, CrawlRange, CrawlSummary } from './mp-types'
import type { DownloadItemResult } from './types'

export interface CrawlDeps {
  mpFetch: MpFetch
  token: string
  downloadOne: (url: string) => Promise<DownloadItemResult>
  sleep?: (ms: number) => Promise<void>
  onProgress?: OnProgress
  /** 测试可注入假 listArticles。 */
  listFn?: (
    mpFetch: MpFetch, token: string, fakeid: string, range: CrawlRange, opts?: { sleep?: (ms: number) => Promise<void> },
  ) => Promise<ArticleRef[]>
}

export async function crawlAccount(fakeid: string, range: CrawlRange, deps: CrawlDeps): Promise<CrawlSummary> {
  const sleep = deps.sleep ?? sleepImpl
  const listFn = deps.listFn ?? listArticlesImpl

  // 列表阶段：命中频控则指数退避，最多 3 次
  let refs: ArticleRef[] = []
  for (let attempt = 0; ; attempt++) {
    try {
      refs = await listFn(deps.mpFetch, deps.token, fakeid, range, { sleep })
      break
    } catch (e) {
      if (e instanceof MpRateLimited && attempt < 3) { await sleep(30000 * (attempt + 1)); continue }
      throw e
    }
  }

  // 下载阶段：复用 DownloadQueue（串行 + 单篇失败不中断 + 汇总），逐篇前插入随机延迟
  const delayed = async (url: string) => { await sleep(randMs(2000, 5000)); return deps.downloadOne(url) }
  const queue = new DownloadQueue(delayed, deps.onProgress)
  const s = await queue.run(refs.map((r) => r.url))

  return {
    ok: s.ok, fakeid, listed: refs.length,
    total: s.total, succeeded: s.succeeded, failed: s.failed, skipped: s.skipped, items: s.items,
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/core/mp-crawl.test.ts`
Expected: PASS（3 个）。

- [ ] **Step 5: 提交**

```bash
git add src/core/mp-crawl.ts tests/core/mp-crawl.test.ts
git commit -m "feat(m3): mp-crawl orchestration with backoff, reusing DownloadQueue"
```

---

## Task 7: 补全 `mp-auth`（getSession / clearSession + 持久化）

**Files:**
- Modify: `electron/services/mp-auth.ts`
- Modify: `.gitignore`

> `login()` 在 Task 1 已写。本任务加持久化与读取，并把 session 落 `userData`。无单测（electron 绑定），由 Task 11/12 的真实 e2e 覆盖。

- [ ] **Step 1: 改 `mp-auth.ts`：login 写盘 + 读/清接口**

```ts
// electron/services/mp-auth.ts —— 顶部 import 增补
import { BrowserWindow, app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import type { MpSession } from '../../src/core/mp-types'

function sessionPath(): string { return join(app.getPath('userData'), 'mp-session.json') }

export function getSession(): MpSession | null {
  try { return JSON.parse(readFileSync(sessionPath(), 'utf-8')) as MpSession } catch { return null }
}
export function clearSession(): void { try { rmSync(sessionPath()) } catch { /* already gone */ } }
```

并在 `login()` 的 `resolve(session)` 之前加一行写盘：

```ts
        const session: MpSession = { token: m[1], cookies, timestamp: Date.now() }
        writeFileSync(sessionPath(), JSON.stringify(session)) // ← 新增
        win.removeListener('closed', onClosed)
        win.destroy()
        resolve(session)
```

- [ ] **Step 2: `.gitignore` 排除 session（保险，userData 本就不在仓库）**

在 `.gitignore` 追加一行：

```
mp-session.json
```

- [ ] **Step 3: 类型检查 + 提交**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无输出（通过）。

```bash
git add electron/services/mp-auth.ts .gitignore
git commit -m "feat(m3): persist/read/clear mp session in userData"
```

---

## Task 8: CLI `search` + `auth-status`

**Files:**
- Modify: `src/cli/index.ts`
- Test: `tests/cli/cli-contract.test.ts`

- [ ] **Step 1: 写失败测试（无 session → AUTH_REQUIRED，退出码 2）**

```ts
// tests/cli/cli-contract.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 掉 electron 绑定的服务，让 runCli 在纯 node 下可测
vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('../../electron/services/mp-auth', () => ({
  getSession: vi.fn(() => null), clearSession: vi.fn(), login: vi.fn(),
}))

import { runCli } from '../../src/cli'
import * as auth from '../../electron/services/mp-auth'

describe('CLI auth gating', () => {
  let stdout = ''
  beforeEach(() => { stdout = ''; vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdout += s; return true }) })

  it('search without session → AUTH_REQUIRED, exit 2', async () => {
    ;(auth.getSession as ReturnType<typeof vi.fn>).mockReturnValue(null)
    const code = await runCli(['search', '猫笔刀'])
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli/cli-contract.test.ts`
Expected: FAIL（当前无 `search` 命令，走 CLI_ERROR 而非 AUTH_REQUIRED）。

- [ ] **Step 3: 在 `src/cli/index.ts` 增补**

顶部 import 增补（注意 `downloadArticle` / `fetchHtml` / `fetchBinary` / `Library` / `BrowserWindow` / `DownloadQueue` 在现有文件已 import，**不要重复**）：

```ts
import { getSession } from '../../electron/services/mp-auth'
import { makeMpFetch } from '../../electron/services/mp-fetch'
import { searchAccount } from '../core/mp-client'
import { crawlAccount } from '../core/mp-crawl'
import { MpAuthExpired } from '../core/mp-errors'
```

新增 JSON 输出助手（放在 `out()` 旁）：

```ts
function outJson(obj: unknown): void { process.stdout.write(JSON.stringify(obj) + '\n') }
```

在 `runCli` 内、`download` 命令之后注册 `search` 与 `auth-status`：

```ts
  program
    .command('search')
    .description('搜索公众号，返回候选列表')
    .argument('<name>', '公众号名称')
    .action(async (name: string) => {
      const session = getSession()
      if (!session) { outJson({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请先执行 wx-kit login' } }); exitCode = 2; return }
      try {
        const list = await searchAccount(makeMpFetch(session), session.token, name)
        outJson({ ok: true, list })
      } catch (e) {
        if (e instanceof MpAuthExpired) { outJson({ ok: false, error: { code: 'AUTH_REQUIRED', message: '登录态失效，请重新 login' } }); exitCode = 2 }
        else { outJson({ ok: false, error: { code: 'MP_API_ERROR', message: (e as Error).message } }); exitCode = 1 }
      }
    })

  program
    .command('auth-status')
    .description('查询登录态是否有效（会做一次廉价真探测）')
    .action(async () => {
      const session = getSession()
      if (!session) { outJson({ ok: true, valid: false }); return }
      try { await searchAccount(makeMpFetch(session), session.token, '腾讯'); outJson({ ok: true, valid: true }) }
      catch (e) { if (e instanceof MpAuthExpired) outJson({ ok: true, valid: false }); else { outJson({ ok: false, error: { code: 'MP_API_ERROR', message: (e as Error).message } }); exitCode = 1 } }
    })
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli/cli-contract.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/cli/index.ts tests/cli/cli-contract.test.ts
git commit -m "feat(m3): CLI search + auth-status with AUTH_REQUIRED contract"
```

---

## Task 9: CLI `crawl`

**Files:**
- Modify: `src/cli/index.ts`
- Test: `tests/cli/cli-contract.test.ts`（追加）

- [ ] **Step 1: 追加失败测试（缺少范围参数 → 用法错误）**

```ts
// tests/cli/cli-contract.test.ts —— 追加
describe('CLI crawl', () => {
  let stdout = ''
  beforeEach(() => { stdout = ''; vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdout += s; return true }) })

  it('crawl without session → AUTH_REQUIRED exit 2', async () => {
    ;(auth.getSession as ReturnType<typeof vi.fn>).mockReturnValue(null)
    const code = await runCli(['crawl', '猫笔刀', '--count', '5'])
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli/cli-contract.test.ts`
Expected: FAIL（无 `crawl` 命令）。

- [ ] **Step 3: 在 `src/cli/index.ts` 注册 `crawl`**

```ts
  program
    .command('crawl')
    .description('批量爬取某公众号')
    .argument('[name]', '公众号名称（或用 --fakeid）')
    .option('--fakeid <id>', '直接指定 fakeid（来自 search）')
    .option('--count <n>', '最近 N 篇')
    .option('--from <date>', '起始日期 YYYY-MM-DD')
    .option('--to <date>', '结束日期 YYYY-MM-DD')
    .option('--formats <csv>', '逗号分隔：cover,md,html,pdf,meta', 'md,html,meta')
    .option('-o, --out <dir>', '文章库根目录', defaultLibraryRoot())
    .action(async (name: string | undefined, opts) => {
      const session = getSession()
      if (!session) { outJson({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请先执行 wx-kit login' } }); exitCode = 2; return }
      const range = opts.count ? { count: Number(opts.count) }
        : (opts.from && opts.to) ? { from: String(opts.from), to: String(opts.to) }
        : null
      if (!range) { outJson({ ok: false, error: { code: 'CLI_ERROR', message: '需要 --count 或 --from/--to' } }); exitCode = 2; return }
      const mpFetch = makeMpFetch(session)
      try {
        // 解析 name → fakeid（有歧义则报错附候选）
        let fakeid = opts.fakeid as string | undefined
        if (!fakeid) {
          if (!name) { outJson({ ok: false, error: { code: 'CLI_ERROR', message: '需要 <name> 或 --fakeid' } }); exitCode = 2; return }
          const cands = await searchAccount(mpFetch, session.token, name)
          if (cands.length === 0) { outJson({ ok: false, error: { code: 'NOT_FOUND', message: `未找到公众号：${name}` } }); exitCode = 1; return }
          if (cands.length > 1) { outJson({ ok: false, error: { code: 'AMBIGUOUS', message: '多个匹配，请用 --fakeid', candidates: cands } }); exitCode = 2; return }
          fakeid = cands[0].fakeid
        }
        const formats = parseFormats(opts.formats)
        const library = new Library(opts.out)
        const ddeps = { fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot: opts.out }
        const summary = await crawlAccount(fakeid, range, {
          mpFetch, token: session.token,
          downloadOne: (url) => downloadArticle(url, formats, ddeps),
          onProgress: (e) => process.stderr.write(`[${e.completed}/${e.total}] ${e.phase} ${e.currentUrl}\n`),
        })
        outJson(summary)
        exitCode = summary.ok ? 0 : 1
      } catch (e) {
        const code = (e as { code?: string }).code ?? 'MP_API_ERROR'
        outJson({ ok: false, error: { code, message: (e as Error).message } })
        exitCode = code === 'AUTH_REQUIRED' ? 2 : 1
      }
    })
```

- [ ] **Step 4: 运行确认通过 + 全量单测**

Run: `npx vitest run`
Expected: PASS（全绿，含既有 62 + 新增）。

- [ ] **Step 5: 提交**

```bash
git add src/cli/index.ts tests/cli/cli-contract.test.ts
git commit -m "feat(m3): CLI crawl (name→fakeid resolve, count/date range)"
```

---

## Task 10: CLI `login` + `library list`

**Files:**
- Modify: `src/cli/index.ts`
- Test: `tests/cli/cli-contract.test.ts`（追加 library list）

- [ ] **Step 1: 追加 library list 测试（用临时库）**

```ts
// tests/cli/cli-contract.test.ts —— 追加
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('CLI library list', () => {
  let stdout = ''
  beforeEach(() => { stdout = ''; vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdout += s; return true }) })

  it('lists articles from a library root as JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-lib-'))
    mkdirSync(join(root, 'acc'), { recursive: true })
    writeFileSync(join(root, 'library.json'), JSON.stringify([
      { id: 'x', title: 'T', account: 'acc', publishTime: '', sourceUrl: '', digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: join(root, 'acc') },
    ]))
    const code = await runCli(['library', 'list', '--out', root])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, items: [{ id: 'x', title: 'T' }] })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli/cli-contract.test.ts`
Expected: FAIL（无 `library list`）。

- [ ] **Step 3: 注册 `login` 与 `library list`**

```ts
  program
    .command('login')
    .description('打开扫码登录窗口，持久化 session')
    .action(async () => {
      try { await login(); outJson({ ok: true }) }
      catch (e) {
        const cancelled = (e as Error).message === 'CANCELLED'
        outJson({ ok: false, error: { code: cancelled ? 'CANCELLED' : 'LOGIN_FAILED', message: (e as Error).message } })
        exitCode = cancelled ? 2 : 1
      }
    })

  const library = program.command('library').description('文章库')
  library
    .command('list')
    .description('列出已下载文章')
    .option('--account <name>', '按公众号过滤')
    .option('-o, --out <dir>', '文章库根目录', defaultLibraryRoot())
    .action(async (opts) => {
      const all = await new Library(opts.out).list()
      const items = opts.account ? all.filter((a) => a.account === opts.account) : all
      outJson({ ok: true, items })
      exitCode = 0
    })
```

并把 `login` 加入顶部 import（与 getSession 同行）：

```ts
import { getSession, login } from '../../electron/services/mp-auth'
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/cli/cli-contract.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/cli/index.ts tests/cli/cli-contract.test.ts
git commit -m "feat(m3): CLI login + library list"
```

---

## Task 11: 真实端到端验证（安哥参与）+ 收尾

**Files:**
- Modify: `ROADMAP.md`、`docs/devlog/wx-kit-vibe-coding.md`

> 自动化测试覆盖不到「真实登录 + 真实爬取」。本任务由安哥跑一次真链路确认。

- [ ] **Step 1: 全量校验**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run lint`
Expected: tsc 无输出、vitest 全绿、lint 0 error。

- [ ] **Step 2: 构建后真实登录**

Run: `npx vite build && npx electron . login`
Expected: 弹窗 → 安哥扫码 → stdout `{"ok":true}`，`userData/mp-session.json` 生成。

- [ ] **Step 3: 真实搜号 + 小批量爬取（自证不封）**

Run: `npx electron . crawl <某公众号名> --count 2 --formats md,meta --out /tmp/wxk-m3`
Expected: stderr 有逐篇进度；stdout 最终 `{"ok":true,"fakeid":...,"listed":...,"succeeded":2,...}`；`/tmp/wxk-m3` 下生成两篇文章文件夹与 `library.json`。

**GATE：** 若返回 `RATE_LIMITED`/`AUTH_REQUIRED` 或字段不符，记录现象，回到对应 Task 修正。

- [ ] **Step 4: 更新状态文档**

- `ROADMAP.md`：M3 行状态改为 `✅ 已合入 main`（合并后），当前状态补一句「CLI 登录+批量爬取已通」。
- `docs/devlog/wx-kit-vibe-coding.md`：按工作流第 6 条，增补 M3 一节（流程/决策/踩坑：BrowserWindow 替代 Playwright、风控码、退避）。

- [ ] **Step 5: 提交收尾**

```bash
git add ROADMAP.md docs/devlog/wx-kit-vibe-coding.md
git commit -m "docs(m3): mark M3 done in ROADMAP, append devlog retrospective"
```

---

## 验收对照（self-review 已核）

- 登录持久化 → Task 1/7；search → Task 8；crawl(数量/日期) → Task 4/5/9；auth-status → Task 8；library list → Task 10。
- 风控：串行+随机延迟（mp-client/mp-crawl）、退避（Task 6）、200013/200040 映射（Task 3）、AUTH_REQUIRED 契约（Task 8/9）。
- 去重续传：复用 `articleId`+`library.has`（downloadArticle 内，Task 9 接线）。
- CLI 契约：stdout 纯 JSON、退出码 0/1/2、stderr 进度（Task 8–10）。
- 非目标（GUI 批量页 / MCP / 暂停 UI）本计划不含——下一切片。
