# M14 供料能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把选中的文库文章导出为 agent 可直接消费的结构化素材——`library export` CLI 输出 JSON 清单（含 content.md 绝对路径），文库 GUI「导出选中为素材」一键写清单到库内 `exports/`。

**Architecture:** 新增 UI 无关核心 `src/core/material-export.ts`：纯函数 `selectArticles`（按 ids/account/since 过滤）+ `buildManifest`（组装清单）+ `writeMaterialExport`（写 `exports/<时间戳>.json`，复用 M13 的 `atomicWriteFile`）。CLI 与 GUI 共用这套核心；CLI 走 stdout JSON，GUI 经新 IPC `library:exportMaterial` 写文件并提示路径。

**Tech Stack:** TypeScript（严格）、Node `fs/promises`、vitest、commander（CLI）、Electron IPC、React + Antd（文库批量条按钮）。

## Global Constraints

- 核心层 `src/core/` **不得 import React/renderer/electron 运行时**（types 可以）；渲染层只经 `window.api` 调用，**绝不直接 import core**。
- 文件 kebab-case；类型 PascalCase；函数/变量 camelCase。
- 改完跑 `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`，全绿才算完成。
- CLI stdout 纯 JSON、退出码 0/1/2；commit message 用英文。
- 与用户交流用中文；代码/标识符/注释用英文（仓库既有注释为中文，沿用）。
- 不引入数据库。`exports/` 目录由本里程碑创建，与 `library.json` 同级；不进文库索引、M13 的 `rebuildLibrary` 已忽略它。
- 清单字段固定为 `{ id, title, account, author, publishTime, sourceUrl, dir, contentPath }`，**不内联正文**（`contentPath` = `join(dir, 'content.md')`）。

---

### Task 1: 核心——选料过滤 + 清单组装（纯函数）

**Files:**
- Create: `src/core/material-export.ts`
- Test: `tests/core/material-export.test.ts`

**Interfaces:**
- Consumes: `ArticleMeta`（`src/core/types.ts`：`{ id, title, author, account, publishTime, sourceUrl, digest, coverUrl, downloadTime, formats, dir }`）。
- Produces:
  - `interface MaterialSelector { ids?: string[]; account?: string; since?: string; all?: boolean }`
  - `interface MaterialArticle { id: string; title: string; account: string; author: string; publishTime: string; sourceUrl: string; dir: string; contentPath: string }`
  - `interface MaterialManifest { ok: true; count: number; articles: MaterialArticle[] }`
  - `selectArticles(all: ArticleMeta[], sel: MaterialSelector): ArticleMeta[]` —— `all:true` 直接返回全部；否则按给定条件取交集（`ids` 命中集合、`account` 大小写不敏感包含匹配、`since` 按 `downloadTime >= 该日00:00`）。
  - `buildManifest(articles: ArticleMeta[]): MaterialManifest` —— 映射成清单，`contentPath = join(dir, 'content.md')`。

- [ ] **Step 1: 写失败测试**

`tests/core/material-export.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { selectArticles, buildManifest } from '../../src/core/material-export'
import type { ArticleMeta } from '../../src/core/types'

const a = (over: Partial<ArticleMeta>): ArticleMeta => ({
  id: 'id', title: 'T', author: 'au', account: 'acc', publishTime: '2026-06-01',
  sourceUrl: 'https://x', digest: '', coverUrl: '', downloadTime: '2026-06-10T00:00:00.000Z',
  formats: ['md'], dir: '/lib/acc/id', ...over,
})

describe('selectArticles', () => {
  const all = [
    a({ id: '1', account: '猫笔刀', downloadTime: '2026-06-20T08:00:00.000Z' }),
    a({ id: '2', account: '刘备教授', downloadTime: '2026-06-21T08:00:00.000Z' }),
    a({ id: '3', account: '猫笔刀', downloadTime: '2026-06-22T08:00:00.000Z' }),
  ]
  it('all:true returns everything', () => {
    expect(selectArticles(all, { all: true }).map((x) => x.id)).toEqual(['1', '2', '3'])
  })
  it('filters by ids', () => {
    expect(selectArticles(all, { ids: ['1', '3'] }).map((x) => x.id)).toEqual(['1', '3'])
  })
  it('filters by account (case-insensitive contains)', () => {
    expect(selectArticles(all, { account: '猫笔刀' }).map((x) => x.id)).toEqual(['1', '3'])
  })
  it('filters by since (downloadTime >= that day 00:00)', () => {
    expect(selectArticles(all, { since: '2026-06-21' }).map((x) => x.id)).toEqual(['2', '3'])
  })
  it('combines selectors as intersection (account AND since)', () => {
    expect(selectArticles(all, { account: '猫笔刀', since: '2026-06-21' }).map((x) => x.id)).toEqual(['3'])
  })
})

describe('buildManifest', () => {
  it('maps articles to the fixed shape with contentPath = dir/content.md', () => {
    const m = buildManifest([a({ id: '1', dir: '/lib/acc/1' })])
    expect(m).toEqual({
      ok: true, count: 1,
      articles: [{
        id: '1', title: 'T', account: 'acc', author: 'au',
        publishTime: '2026-06-01', sourceUrl: 'https://x',
        dir: '/lib/acc/1', contentPath: join('/lib/acc/1', 'content.md'),
      }],
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/material-export.test.ts`
Expected: FAIL —— 无法解析 `../../src/core/material-export`。

- [ ] **Step 3: 写实现**

`src/core/material-export.ts`:

```ts
// src/core/material-export.ts
// 把文库文章选成「素材清单」供外部 agent 消费。纯函数：选料过滤 + 清单组装；
// 写盘（exports/<时间戳>.json）见同文件的 writeMaterialExport（Task 3）。
import { join } from 'node:path'
import type { ArticleMeta } from './types'

export interface MaterialSelector {
  ids?: string[]
  account?: string   // 公众号名，大小写不敏感包含匹配
  since?: string     // YYYY-MM-DD，按 downloadTime >= 该日 00:00 过滤
  all?: boolean
}

export interface MaterialArticle {
  id: string
  title: string
  account: string
  author: string
  publishTime: string
  sourceUrl: string
  dir: string
  contentPath: string   // join(dir, 'content.md')，不内联正文
}

export interface MaterialManifest {
  ok: true
  count: number
  articles: MaterialArticle[]
}

/** 按 selector 过滤；all:true 跳过过滤返回全部，否则给定条件取交集。 */
export function selectArticles(all: ArticleMeta[], sel: MaterialSelector): ArticleMeta[] {
  if (sel.all) return all
  let out = all
  if (sel.ids && sel.ids.length) {
    const set = new Set(sel.ids)
    out = out.filter((m) => set.has(m.id))
  }
  if (sel.account) {
    const k = sel.account.toLowerCase()
    out = out.filter((m) => m.account.toLowerCase().includes(k))
  }
  if (sel.since) {
    const from = Date.parse(`${sel.since}T00:00:00`)
    out = out.filter((m) => {
      const d = Date.parse(m.downloadTime)
      return !Number.isNaN(d) && d >= from
    })
  }
  return out
}

export function buildManifest(articles: ArticleMeta[]): MaterialManifest {
  return {
    ok: true,
    count: articles.length,
    articles: articles.map((m) => ({
      id: m.id,
      title: m.title,
      account: m.account,
      author: m.author,
      publishTime: m.publishTime,
      sourceUrl: m.sourceUrl,
      dir: m.dir,
      contentPath: join(m.dir, 'content.md'),
    })),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/material-export.test.ts`
Expected: PASS（7 passed）。

- [ ] **Step 5: 提交**

```bash
git add src/core/material-export.ts tests/core/material-export.test.ts
git commit -m "feat(core): add material-export selectArticles + buildManifest (agent feed)"
```

---

### Task 2: CLI `library export`

**Files:**
- Modify: `src/cli/index.ts`
- Test: `tests/cli/cli-contract.test.ts`（追加）

**Interfaces:**
- Consumes: `selectArticles`、`buildManifest`（Task 1）；`Library`（既有，`new Library(out).list()`）。
- Produces: CLI `library export` —— 选料器 `--ids <csv>` / `--since <YYYY-MM-DD>` / `--account <name>` / `--all`，`--out <dir>` 默认 `defaultLibraryRoot()`；stdout 输出 `MaterialManifest` JSON，退出码 0；**未给任何选料器时报错**（`{ ok:false, error:{ code:'NO_SELECTOR', message }}` + 退出码 1），避免误导全库。

- [ ] **Step 1: 写失败测试（追加到 `tests/cli/cli-contract.test.ts` 末尾）**

```ts
describe('CLI library export', () => {
  const seed = () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-export-'))
    const dir1 = join(root, 'acc', 'a1')
    writeFileSync(join(root, 'library.json'), JSON.stringify({
      version: 1,
      articles: [
        { id: 'a1', title: 'T1', author: 'au', account: 'acc', publishTime: '2026-06-01', sourceUrl: 'https://x/1', digest: '', coverUrl: '', downloadTime: '2026-06-20T00:00:00.000Z', formats: ['md'], dir: dir1 },
        { id: 'a2', title: 'T2', author: 'au', account: 'other', publishTime: '2026-06-02', sourceUrl: 'https://x/2', digest: '', coverUrl: '', downloadTime: '2026-06-21T00:00:00.000Z', formats: ['md'], dir: join(root, 'other', 'a2') },
      ],
    }))
    return { root, dir1 }
  }

  it('exports selected ids as a JSON manifest with contentPath', async () => {
    const { root, dir1 } = seed()
    const code = await runCli(['library', 'export', '--ids', 'a1', '--out', root])
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    expect(out).toMatchObject({ ok: true, count: 1 })
    expect(out.articles[0]).toMatchObject({ id: 'a1', title: 'T1', contentPath: join(dir1, 'content.md') })
  })

  it('errors (exit 1) when no selector is given', async () => {
    const { root } = seed()
    const code = await runCli(['library', 'export', '--out', root])
    expect(code).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'NO_SELECTOR' } })
  })
})
```

> `mkdtempSync` / `tmpdir` / `join` 该文件顶部已 import；`writeFileSync` 在 Task 6（M13）已以别名 `_writeFileSync` 引入——复用别名 `_writeFileSync`（或文件已有的具名引入，按当前文件实际为准；不要重复声明）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "library export"`
Expected: FAIL —— 未知命令 `export`。

- [ ] **Step 3: 改 `src/cli/index.ts`**

顶部 import 加（与其他 core import 同处）:

```ts
import { selectArticles, buildManifest } from '../core/material-export'
```

在 `library.command('rebuild')…` 之后、`try { await program.parseAsync(...` 之前追加:

```ts
  library
    .command('export')
    .description('把选中的文章导出为 agent 素材清单（JSON 到 stdout）')
    .option('--ids <csv>', '按文章 id 选（逗号分隔）')
    .option('--since <date>', '按下载日期选：YYYY-MM-DD 及之后')
    .option('--account <name>', '按公众号名选（大小写不敏感包含匹配）')
    .option('--all', '导出全库（无选料器时必须显式指定）')
    .option('-o, --out <dir>', '文章库根目录', defaultLibraryRoot())
    .action(async (opts) => {
      const ids = opts.ids ? String(opts.ids).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined
      if (!ids && !opts.since && !opts.account && !opts.all) {
        outJson({ ok: false, error: { code: 'NO_SELECTOR', message: '需指定 --ids / --since / --account 之一，或 --all 导全库' } })
        exitCode = 1
        return
      }
      const all = await new Library(opts.out).list()
      const picked = selectArticles(all, { ids, since: opts.since, account: opts.account, all: opts.all })
      outJson(buildManifest(picked))
      exitCode = 0
    })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/cli/cli-contract.test.ts`
Expected: PASS（含两条新 export 用例 + 原有用例）。

- [ ] **Step 5: 提交**

```bash
git add src/cli/index.ts tests/cli/cli-contract.test.ts
git commit -m "feat(cli): add 'library export' material manifest with --ids/--since/--account/--all"
```

---

### Task 3: 核心 `writeMaterialExport` + IPC `library:exportMaterial` + preload + api

**Files:**
- Modify: `src/core/material-export.ts`（加写盘函数）
- Test: `tests/core/material-export.test.ts`（追加）
- Modify: `electron/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/renderer/api.ts`

**Interfaces:**
- Consumes: `buildManifest`（Task 1）、`atomicWriteFile`（M13，`src/core/atomic-write.ts`）；`Library`、`settings`（既有 ipc 内）。
- Produces:
  - `exportFileName(now: Date): string` —— `YYYYMMDD-HHMMSS.json`。
  - `writeMaterialExport(root: string, manifest: MaterialManifest, now?: Date): Promise<string>` —— 写 `<root>/exports/<时间戳>.json`（原子写），返回该文件绝对路径。
  - IPC `library:exportMaterial(ids: string[])` → `Promise<{ path: string; count: number }>`。
  - `window.api.libraryExportMaterial(ids: string[]): Promise<{ path: string; count: number }>`。

- [ ] **Step 1: 写失败测试（追加到 `tests/core/material-export.test.ts` 末尾）**

```ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { exportFileName, writeMaterialExport } from '../../src/core/material-export'

describe('exportFileName', () => {
  it('formats local YYYYMMDD-HHMMSS.json', () => {
    expect(exportFileName(new Date(2026, 5, 22, 9, 7, 3))).toBe('20260622-090703.json')
  })
})

describe('writeMaterialExport', () => {
  it('writes the manifest under exports/ and returns its absolute path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-matexp-'))
    const manifest = buildManifest([a({ id: '1', dir: join(root, 'acc', '1') })])
    const p = await writeMaterialExport(root, manifest, new Date(2026, 5, 22, 9, 7, 3))
    expect(p).toBe(join(root, 'exports', '20260622-090703.json'))
    expect(JSON.parse(readFileSync(p, 'utf-8'))).toEqual(manifest)
  })
})
```

> `join` 顶部已 import；`a` / `buildManifest` 同文件已定义/导入——复用，勿重复声明。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/material-export.test.ts -t "writeMaterialExport"`
Expected: FAIL —— `writeMaterialExport`/`exportFileName` 未导出。

- [ ] **Step 3a: 追加写盘函数到 `src/core/material-export.ts`**

顶部 import 改为（加 fs/mkdir 与 atomicWriteFile）:

```ts
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { atomicWriteFile } from './atomic-write'
import type { ArticleMeta } from './types'
```

文件末尾追加:

```ts
/** exports 文件名：本地时区 YYYYMMDD-HHMMSS.json。 */
export function exportFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.json`
}

/** 把清单原子写到 <root>/exports/<时间戳>.json，返回绝对路径。 */
export async function writeMaterialExport(root: string, manifest: MaterialManifest, now = new Date()): Promise<string> {
  const dir = join(root, 'exports')
  await mkdir(dir, { recursive: true })
  const path = join(dir, exportFileName(now))
  await atomicWriteFile(path, JSON.stringify(manifest, null, 2))
  return path
}
```

- [ ] **Step 3b: 跑核心测试确认通过**

Run: `npx vitest run tests/core/material-export.test.ts`
Expected: PASS（全部 material-export 用例）。

- [ ] **Step 3c: 改 `electron/ipc.ts`**

顶部 import 加（与其他 core import 同处，紧挨已有的 material/rebuild 等 core 引入）:

```ts
import { selectArticles, buildManifest, writeMaterialExport } from '../src/core/material-export'
```

在 `library:rebuild` handler 之后追加:

```ts
  ipcMain.handle('library:exportMaterial', async (_e, ids: string[]) => {
    const root = (await settings.get()).libraryRoot
    const all = await new Library(root).list()
    const manifest = buildManifest(selectArticles(all, { ids }))
    const path = await writeMaterialExport(root, manifest)
    return { path, count: manifest.count }
  })
```

- [ ] **Step 3d: 改 `electron/preload.ts`**

在 `libraryRebuild` 行之后加:

```ts
  libraryExportMaterial: (ids) => ipcRenderer.invoke('library:exportMaterial', ids),
```

- [ ] **Step 3e: 改 `src/renderer/api.ts`**

在 `libraryRebuild(): …` 之后加方法签名:

```ts
  libraryExportMaterial(ids: string[]): Promise<{ path: string; count: number }>
```

- [ ] **Step 4: 类型检查 + lint + 全量单测**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: tsc 无输出；lint 通过；`npm test` 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/material-export.ts tests/core/material-export.test.ts electron/ipc.ts electron/preload.ts src/renderer/api.ts
git commit -m "feat: writeMaterialExport + library:exportMaterial IPC (writes exports/<ts>.json)"
```

---

### Task 4: 文库 GUI「导出选中为素材」按钮

**Files:**
- Modify: `src/renderer/pages/Library.tsx`

**Interfaces:**
- Consumes: `window.api.libraryExportMaterial`（Task 3）；既有选中态 `sel: Set<string>`、批量条 `.selbar`、`api.reveal`、antd `message`。
- Produces: 批量条内「导出为素材」入口；点击导出选中文章、提示写出路径、可在文件夹显示。

> 本任务为渲染层接线，无单测；以 `tsc` + `lint` + 控制器真机验证为准。

- [ ] **Step 1: 改 `src/renderer/pages/Library.tsx`**

在 `batchDelete` 函数之后加处理器:

```tsx
  const exportMaterial = async () => {
    const ids = [...sel]
    try {
      const { path, count } = await api.libraryExportMaterial(ids)
      message.success({
        content: `已导出 ${count} 篇素材清单 → ${path}`,
        onClick: () => api.reveal(path),
      })
    } catch (e) { message.error('导出失败：' + (e as Error).message) }
  }
```

在批量条 `.selbar` 里、「批量删除」Popconfirm 之前加入口（与 `批量删除` 同样的 `a`/`span` 风格）:

```tsx
            <a data-testid="batch-export" onClick={exportMaterial}>📤 导出为素材</a>
```

具体位置：`<a onClick={selectAll}>全选</a><a onClick={clearSel}>清除</a>` 与 `<Popconfirm …批量删除…>` 之间。

- [ ] **Step 2: 类型检查 + lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 均通过。

- [ ] **Step 3: 真机 GUI 验证（控制器在主会话做，子 agent 跳过）**

构建启动 GUI → 文库多选 ≥1 篇 → 批量条点「导出为素材」→ 出现「已导出 N 篇素材清单 → <库根>/exports/...json」提示；该文件存在且内容为合法 manifest JSON（字段含 `contentPath`）。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/pages/Library.tsx
git commit -m "feat(gui): add 'export selection as material' to library batch bar"
```

---

### Task 5: 收尾——全量验证 + 文档

**Files:**
- Modify: `ROADMAP.md`（M14 状态 + 计划索引）
- Modify: `docs/devlog/wx-kit-vibe-coding.md`（M14 增补）

- [ ] **Step 1: 全量验证**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 全绿。

- [ ] **Step 2: 更新 ROADMAP**

把 v0.4.0 段的 M14 行从 ⏳ 改为 ✅ 已合入 main；在「实现计划（docs/plans/）」索引追加 `- **M14** — docs/plans/2026-06-22-m14-material-feed.md（…，验收 docs/PRD-v0.4.0.md §4 R2）✅ 已合入 main`。

- [ ] **Step 3: devlog 增补 M14（§25）**

记 M14 的「供料边界（wx-kit 只供料、CLI+GUI 同源核心）/ 选料器交集语义 / exports 目录归属」。

- [ ] **Step 4: 提交**

```bash
git add ROADMAP.md docs/devlog/wx-kit-vibe-coding.md
git commit -m "docs: mark M14 material feed done (ROADMAP + devlog §25)"
```

---

## Self-Review

**Spec coverage（对 PRD §4 R2 / spec M14）:**
- `library export` CLI + JSON 清单 + contentPath → Task 1（清单）+ Task 2（CLI）✓
- 选料器 `--ids`/`--since`/`--account`/`--all`，组合取交集，无选料器报错 → Task 1（selectArticles）+ Task 2（CLI 守卫）✓
- GUI「导出选中为素材」写 `exports/<时间戳>.json` + 提示路径 → Task 3（writeMaterialExport + IPC）+ Task 4（按钮）✓
- 清单与 CLI 同源一致（同一 `buildManifest`）→ Task 2 与 Task 3 共用 Task 1 的核心 ✓
- `exports/` 不被文库扫描/重建当文章 → M13 `rebuildLibrary` 已忽略（spec 跨切面），本计划只新建该目录 ✓

**Placeholder scan:** 无 TBD/TODO；每个 code step 给完整代码与确切命令/预期。

**Type consistency:** `MaterialSelector`/`MaterialArticle`/`MaterialManifest`、`selectArticles(all,sel)`、`buildManifest(articles)`、`writeMaterialExport(root,manifest,now?)→string`、`exportFileName(now)→string`、IPC/api `libraryExportMaterial(ids)→{path,count}` 在 Task 1/2/3/4 间一致。

**Scope:** 仅 M14（供料能力）；M15 样例 skill 不在本计划。GUI 按钮无单测（接线），真机验证由控制器在主会话做（子 agent 沙箱跑不了 electron）。
