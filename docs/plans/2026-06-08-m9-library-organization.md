# M9 · 文库组织能力（R6）+ 卡片/列表视图切换

> 对应 PRD-v0.2.0 R6，并入安哥追加的「访达式列表视图」新需求。设计稿经确认（`/tmp/wxk-m9-mock`，已并入本计划的交互约定）。

## 为什么（对用户的影响）
文库只有「按标题搜索 + 删除」，攒到几十上百篇就成垃圾堆。M9 给它**排序 / 按公众号筛选+分组 / 批量删除 / 卡片⇄列表两种视图**，让它从「垃圾堆」变「藏馆」。

## 已确认的交互约定
- **默认**：按公众号**分组** + **卡片**视图。
- **单击** 行/卡 = 选中（切换），不进阅读；选中 ≥1 出现批量条「已选 N · 全选 · 清除 · 批量删除」。
- **双击** 行/卡 = 进入阅读。行尾/卡片 hover 仍有常驻「阅读 / 文件夹 / 删除（二次确认）」。
- 工具栏：`排序`（下载时间/发布时间/标题，升降）· `公众号筛选`（全部/具体号）· `按公众号分组`开关 · `卡片/列表`切换。筛选与分组可叠加。
- **列表分组时列头只显示一次**（顶部），各分区只留「印章+号名+篇数」分隔头。

## 架构落点
- **视图变换是纯逻辑**（排序/分组/筛选作用于已全量载入 renderer 的 `ArticleMeta[]`）→ 放 `src/renderer/library-view.ts`，TDD。不破「renderer 不 import core 运行时」（只 import 类型）。延续 M7 `error-explain` 的归属判断。
- **批量删除**复用既有 `library:remove`（已联动 `history.markDeleted`）：新增 `library:removeMany` 循环之，单次 IPC。

## 分批
### B1 · 视图变换纯逻辑（TDD）
`src/renderer/library-view.ts`：
```ts
export type SortKey = 'download' | 'publish' | 'title'
export type SortDir = 'asc' | 'desc'
export interface AccountGroup { account: string; items: ArticleMeta[] }
export function accountName(m: ArticleMeta): string         // m.account || '未知公众号'
export function accountsOf(list): string[]                  // 去重、首见序，喂筛选下拉
export function filterByAccount(list, account: string|null) // null=全部
export function sortArticles(list, key, dir): ArticleMeta[] // download/publish 比 ISO/日期串；title 用 localeCompare；publish 空串恒置后
export function groupByAccount(list): AccountGroup[]         // 保持排序后的首见组序；组内保序
```
测试 `tests/renderer/library-view.test.ts`：各排序键+方向、空 publishTime 置后、分组保序、筛选、未知公众号归一。

### B2 · 批量删除 IPC
- `electron/ipc.ts`：`library:removeMany`（ids 循环 `remove`+`markDeleted`）。
- `preload.ts` + `api.ts`：`libraryRemoveMany(ids: string[]): Promise<void>`。

### B3 · Library 容器：工具栏 + 状态
`Library.tsx` 状态：`list/root/loading/kw/view('card')/grouped(true)/sortKey('download')/sortDir('desc')/account(null)/sel(Set)`。派生：搜索→筛选→排序→（分组 or 单组）。渲染工具栏 + 批量条 + 内容。

### B4 · 卡片视图（选中 + 分组）
- 扩 `ArticleCard`：`selected`、`onToggleSelect`（单击）、`onOpen`（双击）、选中描边 + 勾选角标；保留 hover 的阅读/文件夹/删除（按钮 `stopPropagation`，不触发选中）。
- 分组分区头（印章+号名+篇数+分隔线，可折叠）。

### B5 · 列表视图（访达式）
- 新 `ArticleRow.tsx`：缩略图·标题(衬线)·公众号·发布·下载·行尾常驻操作；单击选中、双击阅读。
- 列头**只一次**；分组时各分区只有「印章+号名+篇数」头，行在其下。
- CSS 从 mock 移植进 `index.css`（toolbar/group/list/row/selbar）。

### B6 · 验证 + 文档
- `npm test`（B1 纯逻辑全绿）、tsc、lint。
- `npm run test:e2e`（既有文库流不回归：article-card / card-read / card-delete 选择器保留；card-read/delete 按钮 stopPropagation 不误触选中）。
- **真实 session 截图**：卡片分组、列表分组、选中+批量条（驱动到真实数据态）。
- 文档：ROADMAP（M9 ✅ + 计划索引）、PRD（R6 标注实现 + 新增「视图切换」需求记录）、devlog 增补 M9。
- 合回 main 删分支，commit（push 等安哥）。

## e2e 注意
- 单击卡片现在会选中——e2e 不裸点卡片本体（它 hover 后点 `card-read`/`card-delete` 按钮，二者 `stopPropagation`），故不回归。如需新增「列表视图/分组/批量删除」断言，量力而行，避免脆弱。
