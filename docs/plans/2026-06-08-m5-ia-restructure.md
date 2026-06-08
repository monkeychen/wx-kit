# M5 · 信息架构重构（实现计划）

> 需求见 `docs/PRD-v0.2.0.md` §4 / §5。设计已对齐（mockup 签收：切换器用「编辑页签」A 案，文案「按链接下载 / 按公众号下载」）。
> 本里程碑是纯前端重构，无新增纯逻辑 → 无新单测；验证靠 `tsc` + `lint` + 既有 89 单测 + GUI e2e。

## 目标
- 导航四项 → 三项：**下载 / 文库 / 设置**（去掉「批量」，「书架」→「文库」）。
- 「下载」页内双模式：默认**按链接下载**，常驻编辑页签可切到**按公众号下载**；两模式共用「保存为/进度/结果」区。
- 既有下载与爬取逻辑零改动，仅重组容器与导航。

## 关键决策
- **不动业务逻辑**：`UrlDownload`/`BatchCrawl` 的下载/爬取/进度/重试逻辑原样保留，只把它们从「整页」降级为「模式视图」——剥掉各自的 `.page/.page-narrow/.page-head` 外壳，由新的 `Download` 容器统一提供刊头、标题与模式页签。
- **改名只动中文**：路由 `/library`、`data-testid` 等英文标识符保留，避免牵连面。仅面向用户的「书架/批量」字样改。
- **页签 testid**：新增 `mode-url` / `mode-account`，供 e2e 切换。

---

## Task 1 · CSS：模式页签样式
`src/renderer/index.css` 在「页面容器」区后新增：
```css
/* ---------- 下载页模式页签（编辑栏目式） ---------- */
.mode-tabs { display: inline-flex; gap: 30px; border-bottom: 1px solid var(--line); margin: 22px 0 26px; }
.mode-tab {
  position: relative; padding: 0 2px 12px;
  font-family: var(--font-serif); font-size: 19px; font-weight: 700;
  color: var(--ink-faint); background: none; border: none; cursor: pointer;
  transition: color 0.16s ease;
}
.mode-tab:hover { color: var(--ink-soft); }
.mode-tab.on { color: var(--ink); }
.mode-tab.on::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: -1px;
  height: 3px; background: var(--cinnabar); border-radius: 2px;
}
```

## Task 2 · `UrlDownload` → 模式视图
- 重命名 `pages/UrlDownload.tsx` → `components/download/UrlMode.tsx`，组件名 `UrlMode`。
- 删除最外层 `<div className="page"><div className="page-narrow fade-in">…</div></div>` 与 `.page-head`（标题归容器）。
- 返回值改为 `<>` 片段：从 `<Input.TextArea>` 起到结果列表止，原样保留逻辑、state、testid（`start-download`、`result-ok`）。

## Task 3 · `BatchCrawl` → 模式视图
- 重命名 `pages/BatchCrawl.tsx` → `components/download/AccountMode.tsx`，组件名 `AccountMode`。
- 删除外层 `.page/.page-narrow` 与「批量爬取」`.page-head`。三个返回分支都剥壳：
  - `authValid===null` → `<div style={{ textAlign:'center', paddingTop:60 }}><Spin/></div>`
  - `!authValid` → `<LoginGate onLoggedIn={…} />`（容器已提供 narrow）
  - 正常 → 现有搜索框 + 配置卡 + 进度（原样，含 `account-search`/`candidate`/`start-crawl`）。

## Task 4 · 新建 `pages/Download.tsx`
```tsx
import { useState } from 'react'
import UrlMode from '../components/download/UrlMode'
import AccountMode from '../components/download/AccountMode'

type Mode = 'url' | 'account'

export default function Download() {
  const [mode, setMode] = useState<Mode>('url')
  return (
    <div className="page">
      <div className="page-narrow fade-in">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div className="eyebrow">Download</div>
          <h1 className="page-title">下载文章</h1>
        </div>
        <div className="mode-tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'url'} data-testid="mode-url"
            className={`mode-tab${mode === 'url' ? ' on' : ''}`} onClick={() => setMode('url')}>
            按链接下载
          </button>
          <button role="tab" aria-selected={mode === 'account'} data-testid="mode-account"
            className={`mode-tab${mode === 'account' ? ' on' : ''}`} onClick={() => setMode('account')}>
            按公众号下载
          </button>
        </div>
        {mode === 'url' ? <UrlMode /> : <AccountMode />}
      </div>
    </div>
  )
}
```

## Task 5 · 导航改名（`layouts/MainLayout.tsx`）
`NAV` 改为三项：
```ts
const NAV = [
  { to: '/', label: '下载', end: true },
  { to: '/library', label: '文库', end: false },
  { to: '/settings', label: '设置', end: false },
]
```

## Task 6 · 路由（`App.tsx`）
- `index` 由 `Download` 承载；删 `UrlDownload`/`BatchCrawl` 直接导入。
- `/batch` 保留为重定向兜底：`<Route path="batch" element={<Navigate to="/" replace />} />`（防旧书签 404）。
- `library`/`reader/:id`/`settings` 不变。

## Task 7 · 文库改名（`pages/Library.tsx`）
- 标题「书架」→「文库」（含带计数那行）。
- 空状态：`书架还是空的` → `文库还是空的`；提示文案 → `到「下载」页粘贴链接或按公众号抓取，保存的文章会陈列在这里`。
- 印章「藏」、eyebrow「Library」保留。

## Task 8 · e2e 选择器更新（`tests/e2e/gui.e2e.mjs`）
- `nav-书架` → `nav-文库`（2 处）。
- 末段「批量页登录门」：`nav-批量` 路径失效，改为
  ```js
  await win.click('[data-testid="nav-下载"]')
  await win.click('[data-testid="mode-account"]')
  await win.waitForSelector('[data-testid="login-gate"]', { timeout: 10000 })
  assert(true, 'download page · account mode shows login gate without a session')
  ```

## Task 9 · 验证
- `npx tsc --noEmit -p tsconfig.json`
- `npm run lint`
- `npm test`（89 个应仍全绿，无逻辑改动）
- `npm run test:e2e`（清代理跑：导航三项、双模式、文库改名、公众号模式登录门）
- 真实 App 截一张「按公众号下载」模式图补证（隔离 userData 即可，登录门状态足够证明页签切换）。

## 验收对照（PRD §8 相关项）
- 导航为「下载 / 文库 / 设置」；无「书架」「批量」字样。
- 「下载」页可在两模式间切，默认链接模式。
- 既有单测 / e2e 全绿。
