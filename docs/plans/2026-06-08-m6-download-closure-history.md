# M6 · 下载闭环 + 下载历史（实现计划）

> 需求见 `docs/PRD-v0.2.0.md` R1 + R2。设计已对齐（mockup 签收）：R1（就地确认/阅读/格式核对）与 R2（历史追溯/复看/重试）**合并成一个「下载历史」组件**——每条下载动作一个 event，可折叠/展开，展开后逐篇带就地操作。补充决策：列表用「加载更多」懒加载（非页码）；event 上提供「照此再下」回填配置；链接批图标用朱砂「链」字印章（非 emoji）。

## 核心判断（已定）
- **本次结果 = 历史顶部一条、默认展开**：删掉 UrlMode/AccountMode 各自的「结果列表」，下载完成后写一条 history event，刷新历史、顶部展开。运行中仍显示实时进度卡。
- `history.json` 放**库根**（与 `library.json` 并列），class `History` 仿 `Library`。
- 保留期默认 **365 天**、可在设置配；读与追加时裁掉过期 event——**只删记录、不碰文件 / library.json**。
- 「照此再下」：把 event 的 source(范围)+formats 回填到对应模式的配置卡。

---

## A. 核心层（TDD）

### Task 1 · `DownloadItemResult` 补 `title`
`src/core/types.ts`：`DownloadItemResult` 加 `title?: string`。

`src/core/library.ts`：加 `async get(id): Promise<ArticleMeta | undefined>`（read 后 find）。

`src/core/download-article.ts`：
- 成功分支（末行）：`return { url, ok: true, id, dir, formats: meta.formats, title: meta.title }`
- 跳过分支：`const m = await deps.library.get(id); return { url, ok: true, id, skipped: true, title: m?.title }`

测试：`tests/core/download-article.test.ts` 既有用例补断言 `title`；新增 skip 用例断言带 title。

### Task 2 · `src/core/download-history.ts`（新模块，TDD）
类型：
```ts
import type { DownloadFormat } from './types'
import type { CrawlRange } from './mp-types'

export type HistorySource =
  | { kind: 'url'; count: number }
  | { kind: 'account'; nickname: string; fakeid: string; range: CrawlRange }
export type HistoryItemStatus = 'ok' | 'skipped' | 'failed'
export interface HistoryItem {
  id?: string; url: string; title: string
  status: HistoryItemStatus; formats?: DownloadFormat[]; error?: string
}
export interface HistoryEvent {
  id: string; time: number; source: HistorySource; formats: DownloadFormat[]
  total: number; succeeded: number; skipped: number; failed: number
  items: HistoryItem[]
}
interface HistoryFile { version: number; events: HistoryEvent[] }
export const DEFAULT_RETENTION_DAYS = 365
```
纯函数（单测重点）：
```ts
export function pruneEvents(events: HistoryEvent[], now: number, retentionDays: number): HistoryEvent[] {
  const cutoff = now - retentionDays * 86_400_000
  return events.filter((e) => e.time >= cutoff).sort((a, b) => b.time - a.time)  // 时间倒序
}
```
`eventFromSummary`（DownloadSummary→HistoryEvent，纯函数，单测）：
```ts
import type { DownloadSummary } from './types'
export function eventFromSummary(
  id: string, time: number, source: HistorySource, formats: DownloadFormat[], s: DownloadSummary,
): HistoryEvent {
  const items: HistoryItem[] = s.items.map((it) => ({
    id: it.id, url: it.url, title: it.title || it.url,
    status: it.skipped ? 'skipped' : it.ok ? 'ok' : 'failed',
    formats: it.formats, error: it.error?.message,
  }))
  return { id, time, source, formats, total: s.total, succeeded: s.succeeded, skipped: s.skipped, failed: s.failed, items }
}
```
class `History`（仿 Library 的 read/write，注入 root）：
```ts
export class History {
  private path: string
  constructor(private root: string, private retentionDays = DEFAULT_RETENTION_DAYS) { this.path = join(root, 'history.json') }
  private async read(): Promise<HistoryFile> { /* ENOENT → {version:1,events:[]}；corrupt → throw */ }
  private async write(d: HistoryFile) { /* mkdir + writeFile */ }
  /** 倒序 + 裁过期；支持分页切片 */
  async list(offset = 0, limit = 10, now = Date.now()): Promise<{ events: HistoryEvent[]; total: number }> {
    const all = pruneEvents((await this.read()).events, now, this.retentionDays)
    return { events: all.slice(offset, offset + limit), total: all.length }
  }
  async append(ev: HistoryEvent, now = Date.now()): Promise<void> {
    const d = await this.read()
    d.events = pruneEvents([ev, ...d.events], now, this.retentionDays)
    await this.write(d)
  }
  async clear(): Promise<void> { await this.write({ version: 1, events: [] }) }
  /** 文库删文章后，把历史里引用该 id 的 item 标记为已删除（保留记录） */
  async markDeleted(articleId: string): Promise<void> { /* 遍历 events.items，id===articleId 的 → status 不变但置 id=undefined + 加 deleted 标记 */ }
}
```
> markDeleted 细节见 Task 8（文库删除联动）。`deleted` 用 item 上可选 `deleted?: boolean` 表达。

测试 `tests/core/download-history.test.ts`：`pruneEvents`（过期裁剪 + 倒序）、`eventFromSummary`（状态映射 + title 回退）、`History` read/append/clear/list 分页（tmp 目录）。

---

## B. 设置

### Task 3 · `AppSettings` 加保留期
`electron/services/settings.ts`：`AppSettings` 加 `historyRetentionDays: number`；defaults 加 `historyRetentionDays: 365`。

---

## C. 主进程 / IPC

### Task 4 · 写历史 + 历史/清空 IPC（`electron/ipc.ts`）
- `download` handler：`run` 得到 summary 后，
  ```ts
  const h = new History(libraryRoot, (await settings.get()).historyRetentionDays)
  await h.append(eventFromSummary(randId(), Date.now(), { kind: 'url', count: urls.length }, formats, summary))
  return summary
  ```
- `mp:crawl` handler：入参加 `nickname`；done 后 `append(eventFromSummary(..., { kind:'account', nickname, fakeid, range }, formats, summary))`。
- 新增：
  ```ts
  ipcMain.handle('history:list', async (_e, { offset, limit }) => {
    const { libraryRoot, historyRetentionDays } = await settings.get()
    return new History(libraryRoot, historyRetentionDays).list(offset, limit)
  })
  ipcMain.handle('history:clear', async () => {
    const { libraryRoot } = await settings.get(); await new History(libraryRoot).clear()
  })
  ```
- `library:remove` handler：删完后 `await new History(libraryRoot).markDeleted(id)`（联动标记）。

### Task 5 · preload + api.ts
`electron/preload.ts` 暴露 `historyList`/`historyClear`，`mpCrawl` 增 `nickname`。
`src/renderer/api.ts`：
```ts
historyList(offset: number, limit: number): Promise<{ events: HistoryEvent[]; total: number }>
historyClear(): Promise<void>
mpCrawl(fakeid: string, nickname: string, range: CrawlRangeInput, formats: DownloadFormat[]): Promise<CrawlSummary>
```
导出 `HistoryEvent` 等类型（从 core 重导）。

---

## D. Renderer

### Task 6 · `components/download/DownloadHistory.tsx`
- props：`reloadKey`（变化即 reload 并展开顶条）、`onAgain(ev)`（照此再下回填）。
- 状态：`events`、`total`、`expanded: Set<id>`、`loadedCount`。
- 初载 `historyList(0, 10)`；「加载更多」`historyList(loaded, 10)` 累加（`loaded < total` 才显示按钮）。
- `reloadKey` 变化 → 重新 `historyList(0, max(10, loaded))`，并把 `events[0].id` 加入 expanded。
- 行结构（见 mockup）：折叠条（caret + 图标 + 时间·来源·篇数 / 格式·范围 + 成功统计）；展开体逐篇（标题 + 格式徽章 + `阅读`(nav `/reader/:id`)/`文件夹`(`api.reveal`)；失败显示原因 + `重试`）。
- 折叠条尾部加 `照此再下` → `onAgain(ev)`。
- 图标：url 批 = 朱砂「链」字印章（复用 `.seal` 风格）；account = 公众号首字印章。
- account event 第二排显示 `格式 · 范围`（range：`最近 N 篇` 或 `from～to`）。
- 重试：`api.download([item.url], ev.formats)` → 成功后 bump 一个本地 reload。

### Task 7 · `Download.tsx` 容器协调
- 持 `reloadKey`（下载/爬取完成 +1）、`prefill`（照此再下）。
- 渲染顺序：页签 → 配置卡（当前模式）→（运行时实时进度）→ `<DownloadHistory reloadKey onAgain={setPrefillAndSwitch} />`。
- `onAgain(ev)`：`ev.source.kind==='url'` → 切 url 模式 + prefill { text: ev.items.map(i=>i.url).join('\n'), formats }；`account` → 切 account 模式 + prefill { account:{fakeid,nickname}, range, formats }。
- 把 `onDone={() => setReloadKey(k=>k+1)}` 传给两个 mode，在 download/crawl 成功后调用。

### Task 8 · UrlMode / AccountMode 改造
- **删除各自结果列表**（UrlMode 的 `items` 结果区；AccountMode 的 `CrawlProgress` 仅保留运行中实时态，done 后由历史接管）。运行中实时进度保留。
- 完成后调用 `props.onDone()`。
- 接受 `prefill`：UrlMode `prefill?: { text; formats }`（useEffect 写入 state）；AccountMode `prefill?: { account; range; formats }`（直接进入「已选号 + 配置」态）。
- AccountMode `mpCrawl` 调用补 `selected.nickname`。

### Task 9 · 文库删除联动（UI 提示）
- `markDeleted` 已在 Task 4 接好。DownloadHistory 渲染 `deleted` item：标题置灰 + 「已从文库删除」+ 无「阅读」（PRD R2）。

### Task 10 · 设置页（`pages/Settings.tsx`）
- 新增「下载历史」块：保留期（输入框/下拉，单位天，默认 365）+「清空下载历史」按钮（Popconfirm 确认，调 `historyClear`）。文案点明「只清记录，不删已下文件」。

### Task 11 · CSS（`index.css`）
历史区样式：`.hist-head/.hist-title`、`.event/.ev-bar/.ev-caret/.ev-icon/.ev-main/.ev-stat/.ev-body/.art/.art-title/.fmts/.fmt/.act` —— 取 mockup 的样式（暖色、jade/amber/cinnabar 状态色复用既有变量）。

---

## E. 验证

### Task 12 · 测试与端到端
- `npm test`：新增 core 单测全过（download-history、download-article title）。
- `tsc` / `lint` 干净。
- e2e（`tests/e2e/gui.e2e.mjs`）：下载成功后断言改为**历史里出现该文章行 + 「阅读」入口**（旧 `result-ok` testid 移除，换 `data-testid="hist-article"` / `hist-read`）。后续「文库」流程不变。
- **真实 session 截图**（教训：必须真实数据态）：链接下载完成后历史顶条展开、公众号下载历史、照此再下回填——三态各一张。

## 验收对照（PRD §8）
- 一次 URL 下载完成后无需切菜单即可核对格式、就地阅读、在文件夹显示。
- 关闭重开后「最近下载」仍在，可复看与重试。
- 清空历史只删记录，不动文件与文库。
- 文库删文章后，历史对应项标「已删除」。

## 分批建议
若一次太大，可按 commit 切：①核心(Task1-2) → ②IPC/设置(3-5) → ③历史 UI(6-9,11) → ④设置页+联动(10) → ⑤验证(12)。每批自带验证、可独立合入。
