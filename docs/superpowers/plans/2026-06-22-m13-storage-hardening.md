# M13 存储加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `library.json` / `history.json` / `subscriptions.json` 的写入原子化、对并发写串行化，并能从各文章目录的 `meta.json` 重建文库索引。

**Architecture:** 新增两个 UI 无关核心工具——`atomicWriteFile`（写临时文件 + 原子 `rename`）与 `withPathLock`（按文件绝对路径 keyed 的模块级异步互斥锁）；三个索引类（`Library`/`History`/`Subscriptions`）的写入改走原子写、读-改-写整体经写锁串行。再加 `rebuildLibrary`（扫库根各文章目录 `meta.json` 重建 `library.json`），经 CLI `library rebuild`、IPC `library:rebuild` 与设置页按钮暴露。

**Tech Stack:** TypeScript（严格）、Node `fs/promises`、vitest、commander（CLI）、Electron IPC、React + Antd（设置页按钮）。

## Global Constraints

- 核心层（`src/core/`）**不得 import React/renderer/electron 运行时**（types 可以）。
- 文件 kebab-case；类型 PascalCase；函数/变量 camelCase。
- 改完跑 `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`，全绿才算完成。
- CLI stdout 纯 JSON、退出码 0/1/2；commit message 用英文。
- 与用户交流用中文；代码/标识符/注释用英文（本仓库既有注释为中文，沿用既有风格即可）。
- 不引入数据库；不新增持久化字段（本里程碑只改写入方式 + 新增 `exports/` 由 M14 负责，M13 不创建）。

---

### Task 1: `atomicWriteFile` 原子写工具

**Files:**
- Create: `src/core/atomic-write.ts`
- Test: `tests/core/atomic-write.test.ts`

**Interfaces:**
- Consumes: 无（仅 `node:fs/promises`）。
- Produces:
  - `interface AtomicFs { writeFile(path: string, data: string): Promise<void>; rename(from: string, to: string): Promise<void> }`
  - `atomicWriteFile(filePath: string, data: string, fs?: AtomicFs): Promise<void>` —— 写到同目录临时文件后 `rename` 原子替换；`fs` 默认 node 实现，仅供测试注入。

- [ ] **Step 1: 写失败测试**

`tests/core/atomic-write.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as fsp from 'node:fs/promises'
import { atomicWriteFile } from '../../src/core/atomic-write'

const tmp = () => mkdtempSync(join(tmpdir(), 'wxk-atomic-'))

describe('atomicWriteFile', () => {
  it('writes content (round-trip) and leaves no temp file behind', async () => {
    const dir = tmp(); const f = join(dir, 'x.json')
    await atomicWriteFile(f, 'hello')
    expect(readFileSync(f, 'utf-8')).toBe('hello')
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('leaves the original file intact when rename fails', async () => {
    const dir = tmp(); const f = join(dir, 'x.json')
    await atomicWriteFile(f, 'v1')
    const failing = { writeFile: fsp.writeFile, rename: async () => { throw new Error('boom') } }
    await expect(atomicWriteFile(f, 'v2', failing)).rejects.toThrow('boom')
    expect(readFileSync(f, 'utf-8')).toBe('v1')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/atomic-write.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/core/atomic-write"`。

- [ ] **Step 3: 写最小实现**

`src/core/atomic-write.ts`:

```ts
// src/core/atomic-write.ts
// 原子写：写到同目录临时文件 → rename 替换（同一文件系统 rename 原子）。
// 进程中途被杀/断电只会留下未被 rename 的临时文件，目标文件要么是旧内容要么是新内容，不会半截。
import { writeFile as fsWriteFile, rename as fsRename } from 'node:fs/promises'

export interface AtomicFs {
  writeFile(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

const nodeFs: AtomicFs = { writeFile: fsWriteFile, rename: fsRename }

export async function atomicWriteFile(filePath: string, data: string, fs: AtomicFs = nodeFs): Promise<void> {
  const tmp = `${filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, filePath)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/atomic-write.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: 提交**

```bash
git add src/core/atomic-write.ts tests/core/atomic-write.test.ts
git commit -m "feat(core): add atomicWriteFile (temp + rename) for crash-safe index writes"
```

---

### Task 2: `withPathLock` 按路径异步写锁

**Files:**
- Create: `src/core/path-lock.ts`
- Test: `tests/core/path-lock.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T>` —— 同一 `key` 的调用按到达顺序串行执行 `fn`；不同 `key` 互不阻塞。`fn` 抛错只影响该次调用，不毒化后续。

- [ ] **Step 1: 写失败测试**

`tests/core/path-lock.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { withPathLock } from '../../src/core/path-lock'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('withPathLock', () => {
  it('serializes calls with the same key (no interleave)', async () => {
    const order: string[] = []
    const a = withPathLock('k', async () => { order.push('a-start'); await delay(15); order.push('a-end') })
    const b = withPathLock('k', async () => { order.push('b-start'); await delay(1); order.push('b-end') })
    await Promise.all([a, b])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('lets different keys run concurrently', async () => {
    let aStarted = false, bStarted = false
    const a = withPathLock('k1', async () => { aStarted = true; await delay(10) })
    const b = withPathLock('k2', async () => { bStarted = true; await delay(10) })
    await delay(1)
    expect(aStarted && bStarted).toBe(true)
    await Promise.all([a, b])
  })

  it('a rejecting fn does not poison the next call on the same key', async () => {
    await expect(withPathLock('k', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    const ok = await withPathLock('k', async () => 42)
    expect(ok).toBe(42)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/path-lock.test.ts`
Expected: FAIL —— 无法解析 `../../src/core/path-lock`。

- [ ] **Step 3: 写最小实现**

`src/core/path-lock.ts`:

```ts
// src/core/path-lock.ts
// 按 key（用文件绝对路径）串行化「读-改-写」。模块级而非实例级——因为每个 IPC handler 都新建
// Library/History 实例，实例级锁挡不住跨实例并发；同一文件的并发写会读旧值→各自写→丢更新。
const chains = new Map<string, Promise<unknown>>()

export async function withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)          // 不论前一个成功/失败，都接着跑 fn
  const tail = run.catch(() => {})        // 存一个永不 reject 的尾，避免毒化后续
  chains.set(key, tail)
  try {
    return await run
  } finally {
    if (chains.get(key) === tail) chains.delete(key)  // 没有后续排队则清理，避免 Map 无限增长
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/path-lock.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add src/core/path-lock.ts tests/core/path-lock.test.ts
git commit -m "feat(core): add withPathLock to serialize per-file read-modify-write"
```

---

### Task 3: `Library` 改用原子写 + 写锁，损坏提示指向 rebuild

**Files:**
- Modify: `src/core/library.ts`
- Test: `tests/core/library.test.ts`（追加并发用例）

**Interfaces:**
- Consumes: `atomicWriteFile`（Task 1）、`withPathLock`（Task 2）。
- Produces: `Library` 公开方法签名不变（`add`/`remove`/`list`/`get`/`has`/`search`）；行为变化：写原子化、`add`/`remove` 经 `withPathLock(this.indexPath, …)` 串行；corrupt 错误信息改为提示运行 rebuild。

- [ ] **Step 1: 写失败测试（追加到 `tests/core/library.test.ts` 末尾）**

```ts
// —— M13: 并发写不丢更新 ——
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '../../src/core/library'
import type { ArticleMeta } from '../../src/core/types'

const meta = (id: string, root: string): ArticleMeta => ({
  id, title: 'T' + id, author: '', account: 'acc', publishTime: '', sourceUrl: '',
  digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: join(root, 'acc', id),
})

describe('Library concurrent writes (M13)', () => {
  it('serializes concurrent add across instances — no lost update', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-lib-conc-'))
    const a = new Library(root); const b = new Library(root)
    await Promise.all([a.add(meta('1', root)), b.add(meta('2', root))])
    const ids = (await new Library(root).list()).map((x) => x.id).sort()
    expect(ids).toEqual(['1', '2'])
  })
})
```

> 注：若 `tests/core/library.test.ts` 已 import 了 `Library`/`mkdtempSync` 等，删掉本段重复 import，只保留 `describe` 块与 `meta` 助手。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/library.test.ts -t "no lost update"`
Expected: FAIL —— 最终只剩 1 条（`['1']` 或 `['2']`），断言 `['1','2']` 不成立（并发读-改-写丢更新）。

- [ ] **Step 3: 改 `src/core/library.ts`**

把顶部 import 改为（去掉直接 `writeFile`，加两个工具）:

```ts
import { readFile, mkdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { ArticleMeta } from './types'
import { atomicWriteFile } from './atomic-write'
import { withPathLock } from './path-lock'
```

`read()` 的 corrupt 分支改为指向 rebuild:

```ts
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, articles: [] }
      throw new Error(`library index is corrupt at ${this.indexPath} — run "library rebuild" to rebuild it from article folders`)
```

`write()` 改用原子写:

```ts
  private async write(data: LibraryFile): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await atomicWriteFile(this.indexPath, JSON.stringify(data, null, 2))
  }
```

`add()` 整体包进写锁:

```ts
  async add(meta: ArticleMeta): Promise<void> {
    await withPathLock(this.indexPath, async () => {
      const data = await this.read()
      const i = data.articles.findIndex(a => a.id === meta.id)
      if (i >= 0) data.articles[i] = meta
      else data.articles.push(meta)
      await this.write(data)
    })
  }
```

`remove()` 整体包进写锁（fs 删除也在锁内，避免与并发写交错）:

```ts
  async remove(id: string): Promise<void> {
    await withPathLock(this.indexPath, async () => {
      const data = await this.read()
      const entry = data.articles.find(a => a.id === id)
      if (entry?.dir) {
        const resolvedDir = resolve(entry.dir)
        const resolvedRoot = resolve(this.root)
        if (resolvedDir !== resolvedRoot && resolvedDir.startsWith(resolvedRoot + sep)) {
          await rm(resolvedDir, { recursive: true, force: true })
        }
      }
      data.articles = data.articles.filter(a => a.id !== id)
      await this.write(data)
    })
  }
```

（`list`/`get`/`has`/`search` 不变，纯读不加锁。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/library.test.ts`
Expected: PASS（含新并发用例 + 原有用例）。

- [ ] **Step 5: 提交**

```bash
git add src/core/library.ts tests/core/library.test.ts
git commit -m "feat(core): Library uses atomic write + per-file lock; corrupt msg points to rebuild"
```

---

### Task 4: `History` 与 `Subscriptions` 改用原子写 + 写锁

**Files:**
- Modify: `src/core/download-history.ts`
- Modify: `src/core/subscriptions.ts`
- Test: `tests/core/download-history.test.ts`（追加并发用例）

**Interfaces:**
- Consumes: `atomicWriteFile`（Task 1）、`withPathLock`（Task 2）。
- Produces: 两类公开方法签名不变；写入原子化、读-改-写经 `withPathLock(this.path, …)` 串行。

- [ ] **Step 1: 写失败测试（追加到 `tests/core/download-history.test.ts` 末尾）**

```ts
// —— M13: 并发 append 不丢更新 ——
describe('History concurrent append (M13)', () => {
  it('serializes concurrent appends across instances — keeps both', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-hist-conc-'))
    const a = new History(root); const b = new History(root)
    await Promise.all([a.append(ev('e1', 1000 * DAY)), b.append(ev('e2', 1000 * DAY))])
    const { events } = await new History(root).list(0, 10, 1000 * DAY)
    expect(events.map((e) => e.id).sort()).toEqual(['e1', 'e2'])
  })
})
```

> `History` / `ev` / `mkdtempSync` / `tmpdir` / `join` / `DAY` 该文件顶部已 import，无需重复。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/download-history.test.ts -t "keeps both"`
Expected: FAIL —— 只剩一条 event，断言 `['e1','e2']` 不成立。

- [ ] **Step 3a: 改 `src/core/download-history.ts`**

顶部 import 改为:

```ts
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write'
import { withPathLock } from './path-lock'
import type { DownloadFormat, DownloadSummary } from './types'
import type { CrawlRange } from './mp-types'
```

`write()` 改原子写:

```ts
  private async write(data: HistoryFile): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await atomicWriteFile(this.path, JSON.stringify(data, null, 2))
  }
```

`append` / `removeEvent` / `clear` / `markDeleted` 各自整体包进写锁（`list` 纯读不加锁）:

```ts
  async append(ev: HistoryEvent, now = Date.now()): Promise<void> {
    await withPathLock(this.path, async () => {
      const data = await this.read()
      data.events = pruneEvents([ev, ...data.events], now, this.retentionDays)
      await this.write(data)
    })
  }

  async removeEvent(id: string): Promise<void> {
    await withPathLock(this.path, async () => {
      const data = await this.read()
      data.events = data.events.filter((e) => e.id !== id)
      await this.write(data)
    })
  }

  async clear(): Promise<void> {
    await withPathLock(this.path, async () => { await this.write({ version: 1, events: [] }) })
  }

  async markDeleted(articleId: string): Promise<void> {
    await withPathLock(this.path, async () => {
      const data = await this.read()
      let touched = false
      for (const ev of data.events) {
        for (const it of ev.items) {
          if (it.id === articleId) { it.deleted = true; it.id = undefined; touched = true }
        }
      }
      if (touched) await this.write(data)
    })
  }
```

- [ ] **Step 3b: 改 `src/core/subscriptions.ts`**

顶部 import 改为:

```ts
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write'
import { withPathLock } from './path-lock'
import type { ArticleRef } from './mp-types'
import type { HistoryEvent } from './download-history'
```

`write()` 改原子写、`mutate()` 包进写锁（所有写方法都经 `mutate`，一处锁全覆盖）:

```ts
  private async write(data: SubscriptionsFile): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await atomicWriteFile(this.path, JSON.stringify(data, null, 2))
  }
  private async mutate(fn: (d: SubscriptionsFile) => void): Promise<void> {
    await withPathLock(this.path, async () => {
      const d = await this.read(); fn(d); await this.write(d)
    })
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/download-history.test.ts tests/core/subscriptions.test.ts`
Expected: PASS（含新并发用例 + 原有用例）。

- [ ] **Step 5: 提交**

```bash
git add src/core/download-history.ts src/core/subscriptions.ts tests/core/download-history.test.ts
git commit -m "feat(core): History/Subscriptions use atomic write + per-file lock"
```

---

### Task 5: `rebuildLibrary` 从 meta.json 重建索引

**Files:**
- Create: `src/core/rebuild-library.ts`
- Test: `tests/core/rebuild-library.test.ts`

**Interfaces:**
- Consumes: `atomicWriteFile`（Task 1）；`node:fs/promises`。
- Produces:
  - `interface RebuildResult { scanned: number; rebuilt: number; skipped: number }`
  - `rebuildLibrary(root: string): Promise<RebuildResult>` —— 递归扫 `root`（跳过 `exports/` 与 `.` 开头目录）找所有 `meta.json`，解析成功的汇成 `library.json`（`{ version: 1, articles }`）原子写回；`scanned` = 找到的 meta.json 数，`rebuilt` = 解析成功数，`skipped` = 解析失败数。

- [ ] **Step 1: 写失败测试**

`tests/core/rebuild-library.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rebuildLibrary } from '../../src/core/rebuild-library'
import type { ArticleMeta } from '../../src/core/types'

const meta = (id: string, dir: string): ArticleMeta => ({
  id, title: 'T' + id, author: '', account: 'acc', publishTime: '', sourceUrl: '',
  digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir,
})

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'wxk-rebuild-'))
  const a1 = join(root, 'acc1', 'art1'); mkdirSync(a1, { recursive: true })
  writeFileSync(join(a1, 'meta.json'), JSON.stringify(meta('1', a1)))
  const a2 = join(root, 'acc1', 'art2'); mkdirSync(a2, { recursive: true })
  writeFileSync(join(a2, 'meta.json'), JSON.stringify(meta('2', a2)))
  const a3 = join(root, 'acc2', 'art3'); mkdirSync(a3, { recursive: true })
  writeFileSync(join(a3, 'meta.json'), JSON.stringify(meta('3', a3)))
  mkdirSync(join(root, 'acc1', 'art-nometa'), { recursive: true })           // 无 meta → 不计
  mkdirSync(join(root, 'exports'), { recursive: true })                       // 应忽略
  writeFileSync(join(root, 'exports', 'x.json'), '{"any":"thing"}')
  return root
}

describe('rebuildLibrary', () => {
  it('rebuilds library.json from all article meta.json, ignoring exports/', async () => {
    const root = tree()
    const res = await rebuildLibrary(root)
    expect(res).toEqual({ scanned: 3, rebuilt: 3, skipped: 0 })
    const idx = JSON.parse(readFileSync(join(root, 'library.json'), 'utf-8'))
    expect(idx.version).toBe(1)
    expect(idx.articles.map((a: ArticleMeta) => a.id).sort()).toEqual(['1', '2', '3'])
  })

  it('counts a corrupt meta.json as skipped, keeps the rest', async () => {
    const root = tree()
    const bad = join(root, 'acc2', 'art-bad'); mkdirSync(bad, { recursive: true })
    writeFileSync(join(bad, 'meta.json'), '{ not json')
    const res = await rebuildLibrary(root)
    expect(res).toEqual({ scanned: 4, rebuilt: 3, skipped: 1 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/rebuild-library.test.ts`
Expected: FAIL —— 无法解析 `../../src/core/rebuild-library`。

- [ ] **Step 3: 写实现**

`src/core/rebuild-library.ts`:

```ts
// src/core/rebuild-library.ts
// 从库根各文章目录的 meta.json 重建 library.json。文库结构是 root/<公众号>/<文章>/meta.json（两层深），
// 故递归扫描；跳过 exports/（M14 的素材导出目录）与点目录。索引损坏时的恢复手段。
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write'
import type { ArticleMeta } from './types'

export interface RebuildResult { scanned: number; rebuilt: number; skipped: number }

async function findMetaFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('.') || e.name === 'exports') continue
    const sub = join(dir, e.name)
    const inner = await readdir(sub, { withFileTypes: true }).catch(() => [])
    if (inner.some((f) => f.isFile() && f.name === 'meta.json')) {
      out.push(join(sub, 'meta.json'))
    }
    // 继续向下递归（兼容更深层级），但不重复收集同目录
    for (const f of inner) {
      if (f.isDirectory() && !f.name.startsWith('.')) {
        out.push(...await findMetaFiles(sub))
        break
      }
    }
  }
  return [...new Set(out)]
}

export async function rebuildLibrary(root: string): Promise<RebuildResult> {
  const metaPaths = await findMetaFiles(root)
  const articles: ArticleMeta[] = []
  let skipped = 0
  for (const p of metaPaths) {
    try {
      articles.push(JSON.parse(await readFile(p, 'utf-8')) as ArticleMeta)
    } catch {
      skipped++
    }
  }
  await atomicWriteFile(join(root, 'library.json'), JSON.stringify({ version: 1, articles }, null, 2))
  return { scanned: metaPaths.length, rebuilt: articles.length, skipped }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/rebuild-library.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: 提交**

```bash
git add src/core/rebuild-library.ts tests/core/rebuild-library.test.ts
git commit -m "feat(core): add rebuildLibrary to reconstruct index from article meta.json"
```

---

### Task 6: CLI `library rebuild` 子命令

**Files:**
- Modify: `src/cli/index.ts`
- Test: `tests/cli/cli-contract.test.ts`（追加）

**Interfaces:**
- Consumes: `rebuildLibrary`（Task 5）。
- Produces: CLI `library rebuild --out <dir>` → stdout `{ ok: true, scanned, rebuilt, skipped }`，退出码 0。

- [ ] **Step 1: 写失败测试（追加到 `tests/cli/cli-contract.test.ts` 末尾）**

```ts
import { mkdirSync as _mkdirSync, writeFileSync as _writeFileSync } from 'node:fs'

describe('CLI library rebuild', () => {
  it('rebuilds library.json from meta.json and reports counts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-rebuild-'))
    const art = join(root, 'acc', 'art1'); _mkdirSync(art, { recursive: true })
    _writeFileSync(join(art, 'meta.json'), JSON.stringify({
      id: 'z', title: 'T', author: '', account: 'acc', publishTime: '', sourceUrl: '',
      digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: art,
    }))
    const code = await runCli(['library', 'rebuild', '--out', root])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, scanned: 1, rebuilt: 1, skipped: 0 })
  })
})
```

> `mkdtempSync` / `tmpdir` / `join` 文件顶部已 import；`mkdirSync`/`writeFileSync` 用上面的别名 import 避免与既有冲突。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "reports counts"`
Expected: FAIL —— 未知命令 `rebuild`（commander 报错 / 非 0 退出）。

- [ ] **Step 3: 改 `src/cli/index.ts`**

顶部 import 加:

```ts
import { rebuildLibrary } from '../core/rebuild-library'
```

在 `library.command('list')…` 这一段之后、`try { await program.parseAsync(...` 之前，追加子命令:

```ts
  library
    .command('rebuild')
    .description('从各文章目录的 meta.json 重建文库索引（library.json 损坏时的恢复手段）')
    .option('-o, --out <dir>', '文章库根目录', defaultLibraryRoot())
    .action(async (opts) => {
      const res = await rebuildLibrary(opts.out)
      outJson({ ok: true, ...res })
      exitCode = 0
    })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/cli/cli-contract.test.ts`
Expected: PASS（含新 rebuild 用例 + 原有用例）。

- [ ] **Step 5: 提交**

```bash
git add src/cli/index.ts tests/cli/cli-contract.test.ts
git commit -m "feat(cli): add 'library rebuild' to reconstruct index from disk"
```

---

### Task 7: IPC + preload + api + 设置页「重建文库索引」按钮

**Files:**
- Modify: `electron/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/renderer/api.ts`
- Modify: `src/renderer/pages/Settings.tsx`

**Interfaces:**
- Consumes: `rebuildLibrary`（Task 5）。
- Produces:
  - IPC `library:rebuild` → `Promise<RebuildResult>`。
  - `window.api.libraryRebuild(): Promise<{ scanned: number; rebuilt: number; skipped: number }>`。
  - 设置页「文章库位置」块内新增「重建索引」按钮。

> 本任务为主进程/渲染接线，无纯逻辑单测（核心逻辑已在 Task 5 覆盖）；以 `tsc` + `npm run lint` + 真机 GUI 验证为准。

- [ ] **Step 1: 改 `electron/ipc.ts`**

顶部已有 `import { Library } from '../src/core/library'`（确认）。加 rebuild import（与其他 core import 同处）:

```ts
import { rebuildLibrary } from '../src/core/rebuild-library'
```

在 `library:removeMany` handler 之后追加:

```ts
  ipcMain.handle('library:rebuild', async () => rebuildLibrary((await settings.get()).libraryRoot))
```

- [ ] **Step 2: 改 `electron/preload.ts`**

在 `libraryRemoveMany` 行之后加:

```ts
  libraryRebuild: () => ipcRenderer.invoke('library:rebuild'),
```

- [ ] **Step 3: 改 `src/renderer/api.ts`**

在 `libraryRemoveMany(ids: string[]): Promise<void>` 之后加方法签名:

```ts
  libraryRebuild(): Promise<{ scanned: number; rebuilt: number; skipped: number }>
```

- [ ] **Step 4: 改 `src/renderer/pages/Settings.tsx`**

在 `clearHistory` 函数之后加处理器:

```tsx
  const rebuildIndex = async () => {
    try {
      const r = await api.libraryRebuild()
      message.success(`已重建文库索引：扫描 ${r.scanned} 篇，重建 ${r.rebuilt} 篇，跳过 ${r.skipped} 篇`)
    } catch (e) { message.error('重建失败：' + (e as Error).message) }
  }
```

在「文章库位置」块（`setting-block` 内 `Space.Compact` 之后）追加按钮 + 提示:

```tsx
            <div className="setting-hint" style={{ marginTop: 10 }}>
              若文库列表异常为空或提示索引损坏，可从磁盘各文章目录的 meta.json 重建索引（不动已下载文件）。
            </div>
            <Popconfirm title="重建文库索引？" description="扫描库目录重建 library.json，不会删除任何文章文件。"
              okText="重建" cancelText="取消" onConfirm={rebuildIndex}>
              <Button style={{ marginTop: 8 }}>重建索引</Button>
            </Popconfirm>
```

- [ ] **Step 5: 类型检查 + lint + 全量单测**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: tsc 无输出（通过）；lint 通过；`npm test` 全绿。

- [ ] **Step 6: 真机 GUI 验证（主会话/本地）**

构建并启动 GUI，进「设置 → 文章库位置」，点「重建索引」→ Popconfirm 确认 → 出现「已重建文库索引：扫描 N 篇…」成功提示；文库列表正常。

```bash
npm run dev   # 或对照 AGENTS.md 的 e2e/启动方式
```

- [ ] **Step 7: 提交**

```bash
git add electron/ipc.ts electron/preload.ts src/renderer/api.ts src/renderer/pages/Settings.tsx
git commit -m "feat(gui): add 'rebuild library index' action (IPC + settings button)"
```

---

### Task 8: 收尾——全量验证 + 文档

**Files:**
- Modify: `ROADMAP.md`（M13 状态）
- Modify: `docs/devlog/wx-kit-vibe-coding.md`（M13 增补）

- [ ] **Step 1: 全量验证**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 全绿。

- [ ] **Step 2: 更新 ROADMAP**

在「v0.4.0 迭代」段把 M13 标为 ✅ 已合入 main（若该段未建则新建，仿 v0.3.0 段式样：里程碑表 + 当前状态条目）。

- [ ] **Step 3: devlog 增补 M13**

`docs/devlog/wx-kit-vibe-coding.md` 追加一节（§24），记 M13 的「为什么先夯地基/原子写+写锁+rebuild 三件套/并发丢更新这种隐性 bug 怎么用并发测试逼出来」。

- [ ] **Step 4: 提交**

```bash
git add ROADMAP.md docs/devlog/wx-kit-vibe-coding.md
git commit -m "docs: mark M13 storage hardening done (ROADMAP + devlog)"
```

---

## Self-Review

**Spec coverage（对 PRD §3 R1 / spec M13）:**
- 原子写 → Task 1 + 接线 Task 3/4 ✓
- 写串行化（按路径模块级锁）→ Task 2 + 接线 Task 3/4 ✓
- rebuild（core / CLI / IPC / GUI 入口）→ Task 5 / 6 / 7 ✓
- 损坏提示指向 rebuild → Task 3（library `read()` 文案）✓
- `exports/` 与非文章目录被重建忽略 → Task 5（`findMetaFiles` 跳过 `exports`/点目录）+ 测试断言 ✓
- 验收「两实例并发 add 不丢更新」「同路径串行/不同路径并行」「rebuild 计数」「GUI 入口可重建」→ Task 3 / 2 / 5,6 / 7 ✓

**Placeholder scan:** 无 TBD/TODO；每个 code step 给了完整代码与确切命令/预期。

**Type consistency:** `atomicWriteFile(filePath,data,fs?)`、`withPathLock<T>(key,fn)`、`rebuildLibrary(root)→RebuildResult{scanned,rebuilt,skipped}`、`api.libraryRebuild()→{scanned,rebuilt,skipped}` 在 Task 5/6/7 间一致；`AtomicFs.{writeFile,rename}` 与注入测试一致。

**Scope:** 仅 M13（存储加固）；M14/M15 不在本计划。`exports/` 目录由 M14 创建，本计划只在 rebuild 扫描时忽略它，不创建。
