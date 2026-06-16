# M10 列表视图优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文库「列表」视图支持列宽拖拽调整与点击表头排序，卡片视图保留工具栏排序入口。

**Architecture:** 纯 renderer 展示层改动。列宽持久化进 `settings.json`（新增 `AppSettings.listColumnWidths`）。可测的纯逻辑（grid 模板生成、排序状态切换、宽度钳制）抽到 `src/renderer/list-columns.ts` 走单测；DOM/鼠标交互（拖拽、点表头）由本地 e2e 验证。列宽通过 CSS 变量 `--lcols` 驱动 `.lhead`/`.lrow` 的 `grid-template-columns`。

**Tech Stack:** React 18 + TypeScript + Vite，Vitest 单测，Playwright Electron e2e。

设计依据：`docs/superpowers/specs/2026-06-16-v0.3.0-list-polish-and-subscriptions-design.md`（M10 段）。

---

## 文件结构

- **Modify** `electron/services/settings.ts` — `AppSettings` 增 `listColumnWidths`，`defaults()` 给默认值。
- **Modify** `tests/electron/settings.test.ts` — 现有 3 处整对象 `toEqual` 补字段 + 加一条默认值断言。
- **Create** `src/renderer/list-columns.ts` — 纯逻辑：宽度类型/默认值、`buildListColumns`、`clampColWidth`、`nextSort`。
- **Create** `tests/renderer/list-columns.test.ts` — 上述纯函数单测。
- **Modify** `src/renderer/pages/Library.tsx` — 接入列宽状态、表头排序、拖拽手柄；工具栏排序控件仅卡片视图显示。
- **Modify** `src/renderer/index.css` — `.lhead/.lrow` 改用 `var(--lcols)`；新增表头可排序/拖拽手柄样式。
- **Modify** `tests/e2e/gui.e2e.mjs` — 列表视图表头排序 + 列宽拖拽断言。

---

## Task 1: settings 增列宽字段

**Files:**
- Modify: `electron/services/settings.ts`
- Test: `tests/electron/settings.test.ts`

- [ ] **Step 1: 先改测试（会失败）**

把 `tests/electron/settings.test.ts` 三处整对象断言补上新字段，并新增一条默认值断言。默认列宽 `{ account: 132, publish: 150, download: 110 }`。

第 15 行改为：
```ts
    expect(v).toEqual({ libraryRoot: '/default/lib', defaultFormats: ['md', 'html', 'meta'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 } })
```

第 22 行改为：
```ts
    expect(await s2.get()).toEqual({ libraryRoot: '/custom', defaultFormats: ['md', 'pdf'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 } })
```

第 29 行改为：
```ts
    expect(await s.get()).toEqual({ libraryRoot: '/custom', defaultFormats: ['html'], historyRetentionDays: 365, listColumnWidths: { account: 132, publish: 150, download: 110 } })
```

在 `describe` 末尾（第 30 行后）新增：
```ts
  it('persists custom list column widths', async () => {
    const s = new SettingsService(dir, '/default/lib')
    await s.save({ listColumnWidths: { account: 200, publish: 180, download: 120 } })
    const s2 = new SettingsService(dir, '/default/lib')
    expect((await s2.get()).listColumnWidths).toEqual({ account: 200, publish: 180, download: 120 })
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/electron/settings.test.ts`
Expected: FAIL —— 类型上 `listColumnWidths` 不存在 / 默认值不含该字段。

- [ ] **Step 3: 实现**

`electron/services/settings.ts` 的 `AppSettings` 接口增字段，`defaults()` 增默认值：

```ts
export interface ListColumnWidths { account: number; publish: number; download: number }

export interface AppSettings {
  libraryRoot: string
  defaultFormats: DownloadFormat[]
  historyRetentionDays: number
  listColumnWidths: ListColumnWidths
}
```

`defaults()` 改为：
```ts
  private defaults(): AppSettings {
    return {
      libraryRoot: this.defaultLibraryRoot,
      defaultFormats: ['md', 'html', 'meta'],
      historyRetentionDays: 365,
      listColumnWidths: { account: 132, publish: 150, download: 110 },
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/electron/settings.test.ts`
Expected: PASS（4 条）。

- [ ] **Step 5: 提交**

```bash
git add electron/services/settings.ts tests/electron/settings.test.ts
git commit -m "feat(settings): add listColumnWidths with sensible defaults"
```

---

## Task 2: list-columns 纯逻辑

**Files:**
- Create: `src/renderer/list-columns.ts`
- Test: `tests/renderer/list-columns.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/renderer/list-columns.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { buildListColumns, clampColWidth, nextSort, DEFAULT_LIST_WIDTHS, MIN_COL } from '../../src/renderer/list-columns'

describe('buildListColumns', () => {
  it('non-grouped: thumb | title-1fr | account | publish | download | actions', () => {
    expect(buildListColumns({ account: 132, publish: 150, download: 110 }, false))
      .toBe('44px minmax(0, 1fr) 132px 150px 110px 172px')
  })
  it('grouped: drops the account column', () => {
    expect(buildListColumns({ account: 132, publish: 150, download: 110 }, true))
      .toBe('44px minmax(0, 1fr) 150px 110px 172px')
  })
})

describe('clampColWidth', () => {
  it('floors at MIN_COL and rounds', () => {
    expect(clampColWidth(10)).toBe(MIN_COL)
    expect(clampColWidth(150.7)).toBe(151)
  })
})

describe('nextSort', () => {
  it('clicking a new key uses its default direction', () => {
    expect(nextSort({ key: 'download', dir: 'desc' }, 'title')).toEqual({ key: 'title', dir: 'asc' })
    expect(nextSort({ key: 'title', dir: 'asc' }, 'publish')).toEqual({ key: 'publish', dir: 'desc' })
  })
  it('clicking the same key flips direction', () => {
    expect(nextSort({ key: 'publish', dir: 'desc' }, 'publish')).toEqual({ key: 'publish', dir: 'asc' })
    expect(nextSort({ key: 'publish', dir: 'asc' }, 'publish')).toEqual({ key: 'publish', dir: 'desc' })
  })
})

it('DEFAULT_LIST_WIDTHS matches settings default', () => {
  expect(DEFAULT_LIST_WIDTHS).toEqual({ account: 132, publish: 150, download: 110 })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/renderer/list-columns.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`src/renderer/list-columns.ts`：
```ts
// src/renderer/list-columns.ts
// 列表视图列宽与表头排序的纯逻辑。不 import 任何 core/electron 运行时。
import type { SortKey, SortDir } from './library-view'

export interface ListColumnWidths { account: number; publish: number; download: number }
export const DEFAULT_LIST_WIDTHS: ListColumnWidths = { account: 132, publish: 150, download: 110 }
export const MIN_COL = 64

/** 拖拽后钳制：不小于 MIN_COL，取整。 */
export function clampColWidth(px: number): number {
  return Math.max(MIN_COL, Math.round(px))
}

/** 由列宽 + 是否分组生成 grid-template-columns。
 *  布局：缩略图 44px | 标题 1fr | [公众号]（仅非分组）| 发布 | 下载 | 操作 172px。 */
export function buildListColumns(w: ListColumnWidths, grouped: boolean): string {
  const mid = grouped
    ? `${w.publish}px ${w.download}px`
    : `${w.account}px ${w.publish}px ${w.download}px`
  return `44px minmax(0, 1fr) ${mid} 172px`
}

export interface SortState { key: SortKey; dir: SortDir }
const DEFAULT_DIR: Record<SortKey, SortDir> = { title: 'asc', publish: 'desc', download: 'desc' }

/** 点击表头：同列翻转方向；换列用该列默认方向（标题升序、时间降序）。 */
export function nextSort(cur: SortState, clicked: SortKey): SortState {
  if (cur.key === clicked) return { key: clicked, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
  return { key: clicked, dir: DEFAULT_DIR[clicked] }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/renderer/list-columns.test.ts`
Expected: PASS（5 条）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/list-columns.ts tests/renderer/list-columns.test.ts
git commit -m "feat(library): add list-columns pure logic (grid template, sort toggle, clamp)"
```

---

## Task 3: 表头点击排序 + 工具栏排序仅卡片视图

**Files:**
- Modify: `src/renderer/pages/Library.tsx`
- Modify: `src/renderer/index.css`

- [ ] **Step 1: 接入纯逻辑与状态**

`src/renderer/pages/Library.tsx` 顶部 import（第 1 行 react import 改为含 `useRef`，并加 list-columns、settings 类型 import）：

第 1 行改为：
```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
```

在第 11 行 `} from '../library-view'` 之后插入：
```tsx
import { buildListColumns, clampColWidth, nextSort, DEFAULT_LIST_WIDTHS } from '../list-columns'
import type { ListColumnWidths } from '../../electron/services/settings'
```

在第 27 行 `const [collapsed, ...]` 之后插入列宽状态与 ref：
```tsx
  const [widths, setWidths] = useState<ListColumnWidths>(DEFAULT_LIST_WIDTHS)
  const widthsRef = useRef(widths)
  useEffect(() => { widthsRef.current = widths }, [widths])
```

把 `load()`（第 33 行）里读到的 settings 用于初始化列宽。第 34 行改为：
```tsx
      setAll(list); setRoot(s.libraryRoot); setWidths(s.listColumnWidths ?? DEFAULT_LIST_WIDTHS)
```

- [ ] **Step 2: 加表头排序与拖拽的处理函数**

在第 63 行 `const read = ...` 之前插入：
```tsx
  const onHeaderSort = (k: SortKey) => {
    const n = nextSort({ key: sortKey, dir: sortDir }, k)
    setSortKey(n.key); setSortDir(n.dir)
  }
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')
  const startResize = (key: keyof ListColumnWidths, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startW = widths[key]
    const onMove = (ev: MouseEvent) => setWidths((w) => ({ ...w, [key]: clampColWidth(startW + ev.clientX - startX) }))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      api.saveSettings({ listColumnWidths: widthsRef.current })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
```

- [ ] **Step 3: 工具栏排序控件仅卡片视图显示**

把工具栏里「排序」标签 + sort-select + sort-dir（当前第 102–106 行）整体用 `view === 'card'` 包起来。替换这三行块为：

```tsx
          {view === 'card' && <>
            <span className="tb-label">排序</span>
            <span data-testid="sort-select"><Select size="middle" value={sortKey} onChange={(v) => setSortKey(v)} style={{ width: 116 }}
              options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ value: k, label: SORT_LABEL[k] }))} /></span>
            <button className="tb-dir" data-testid="sort-dir" title={sortDir === 'desc' ? '降序' : '升序'}
              onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}>{sortDir === 'desc' ? '↓' : '↑'}</button>
          </>}
```

- [ ] **Step 4: 重写列表表头（排序 + 拖拽手柄），并把 --lcols 挂到 .list**

把列表视图容器（当前第 136 行）改为带 `--lcols` 内联样式：
```tsx
          <div className={`list${grouped ? ' grouped' : ''}`} style={{ ['--lcols' as string]: buildListColumns(widths, grouped) }}>
```

把表头块（当前第 137–140 行的 `<div className="lhead">…</div>`）整体替换为：
```tsx
            <div className="lhead">
              <span></span>
              <span className="lh-sort" onClick={() => onHeaderSort('title')}>标题{arrow('title')}</span>
              {!grouped && (
                <span className="lh-resz">公众号<i className="rz" onMouseDown={(e) => startResize('account', e)} /></span>
              )}
              <span className="lh-sort lh-resz" onClick={() => onHeaderSort('publish')}>
                发布时间{arrow('publish')}<i className="rz" onMouseDown={(e) => startResize('publish', e)} />
              </span>
              <span className="lh-sort lh-resz" onClick={() => onHeaderSort('download')}>
                下载时间{arrow('download')}<i className="rz" onMouseDown={(e) => startResize('download', e)} />
              </span>
              <span style={{ textAlign: 'right' }}>操作</span>
            </div>
```

- [ ] **Step 5: CSS —— var 驱动 grid + 表头样式**

`src/renderer/index.css`：

第 412 行的 `grid-template-columns: 44px minmax(0, 1fr) 132px 100px 100px 172px;` 改为：
```css
.lhead, .lrow { display: grid; grid-template-columns: var(--lcols, 44px minmax(0, 1fr) 132px 150px 110px 172px); align-items: center; }
```

删除第 413–414 行（分组态的写死列模板与其注释）——现由 `buildListColumns(grouped)` 经 `--lcols` 统一驱动。

在 `.lacts button.danger:hover` 规则（约第 430 行）之后插入：
```css
/* 列表表头：可排序列 + 列宽拖拽手柄 */
.lh-sort { cursor: pointer; user-select: none; }
.lh-sort:hover { color: var(--ink); }
.lh-resz { position: relative; }
.lh-resz .rz { position: absolute; top: 0; right: 0; width: 7px; height: 100%; cursor: col-resize; }
.lh-resz .rz:hover { background: var(--cinnabar-wash); }
```

- [ ] **Step 6: 验证（类型 + lint + 构建）**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: 三者皆通过，无类型/lint 错误。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/pages/Library.tsx src/renderer/index.css
git commit -m "feat(library): header-click sort in list view; toolbar sort kept for card view"
```

---

## Task 4: e2e 断言 + 全量验证

**Files:**
- Modify: `tests/e2e/gui.e2e.mjs`

- [ ] **Step 1: 插入列表视图表头排序 + 列宽拖拽断言**

在 `tests/e2e/gui.e2e.mjs` 列表视图段（当前第 178 行 `await win.waitForSelector('[data-testid="article-row"]', …)` 之后、第 180 行双击行之前）插入：

```js
    // M10: 列表视图表头点击排序（先取消分组，得到确定的全局顺序）
    await win.click('[data-testid="group-toggle"]')
    const firstRowText = async () => (await win.locator('[data-testid="article-row"] .ltitle').first().textContent()) || ''
    await win.click('.lhead .lh-sort:has-text("标题")')        // 先切到标题列，规避进列表前的残留排序态
    await win.click('.lhead .lh-sort:has-text("发布时间")')    // 换列 → 默认降序 → 最新在前
    assert((await firstRowText()).includes('贝塔'), 'list header sort by publish desc puts newest (贝塔) first')
    await win.click('.lhead .lh-sort:has-text("发布时间")')    // 同列再点 → 翻转升序 → 最旧在前
    assert((await firstRowText()).includes('伽马'), 'clicking same header flips to asc (oldest 伽马 first)')

    // M10: 列宽拖拽 —— 拖发布时间列手柄，--lcols 应变化
    const colsBefore = await win.locator('.list').evaluate((el) => getComputedStyle(el).getPropertyValue('--lcols'))
    const rzBox = await win.locator('.lhead .lh-resz:has-text("发布时间") .rz').boundingBox()
    await win.mouse.move(rzBox.x + 3, rzBox.y + rzBox.height / 2)
    await win.mouse.down()
    await win.mouse.move(rzBox.x + 60, rzBox.y + rzBox.height / 2, { steps: 6 })
    await win.mouse.up()
    const colsAfter = await win.locator('.list').evaluate((el) => getComputedStyle(el).getPropertyValue('--lcols'))
    assert(colsBefore !== colsAfter, 'dragging a column handle resizes the column (--lcols changed)')

    await win.click('[data-testid="group-toggle"]')           // 复原分组，供后续步骤
```

> 注：种子数据里 `贝塔` 为发布时间最新、`伽马` 最旧（见同文件 card-view 排序断言）。运行时若种子调整，按实际最新/最旧文章名校正。

- [ ] **Step 2: 跑全量验证（本地）**

Run: `npm test && npm run lint && npx tsc --noEmit -p tsconfig.json && npm run test:e2e`
Expected: 单测全绿（含新增 list-columns、settings）；lint/类型干净；e2e 全部 `✓`，末行 `no console/page errors`。

> e2e 只能在主会话/本地跑（子 agent 沙箱解析不了 electron 二进制）。

- [ ] **Step 3: 提交**

```bash
git add tests/e2e/gui.e2e.mjs
git commit -m "test(e2e): assert list-view header sort and column resize"
```

---

## Self-Review 记录

- **Spec 覆盖**：列宽可调（Task 1 持久化 + Task 3/4 拖拽）、表头排序（Task 2 纯逻辑 + Task 3 接入）、卡片视图保留工具栏排序（Task 3 Step 3）—— 全覆盖。
- **类型一致**：`ListColumnWidths` 定义于 `settings.ts` 并被 `list-columns.ts`/`Library.tsx` 复用同名；`SortKey/SortDir/SortState` 与 `library-view.ts` 一致；`buildListColumns/clampColWidth/nextSort/DEFAULT_LIST_WIDTHS/MIN_COL` 命名前后一致。
- **无 placeholder**：每步含确切代码与命令。
- **回归点**：`settings.test.ts` 三处整对象断言已随默认值变更同步更新（Task 1 Step 1），不会漏。
