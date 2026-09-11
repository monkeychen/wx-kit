# M59 · 文库单篇复制保存路径（v0.11.0 R1）

> 需求/验收：`docs/PRD-v0.11.0.md` §3 R1、§6 R1。
> 纯 renderer 变更 + 一个纯函数模块，零 IPC/核心层改动。

## 关键事实（plan 前实测，改变实现形状）

1. **`meta.dir` 本身就是绝对路径**（`src/core/types.ts:39` 注释「文章文件夹绝对路径」）。
   → 复制内容 = `meta.dir`，**无需拼接 `<libraryRoot>/`**，Windows 路径天然正确。
   PRD §3 R1「复制内容 = `<libraryRoot>/<meta.dir>`」结果等价、实现更简；收尾时把 PRD 该句修正为
   「复制内容 = `meta.dir`（本身就是绝对路径）」。验收条款「剪贴板含绝对路径」不变。
2. **`api.copyText`（`clipboard:write` IPC）已存在**（M30 导出弹窗在用，`electron/preload.ts:27`）→ 零新增 IPC。
3. **卡片视图当前没有任何右键菜单**（全库 grep 无 contextmenu）→ 新建，用项目已有的 antd
   `Dropdown`（`trigger={['contextMenu']}`）实现，风格与 Popconfirm/message 一致。
4. **renderer 无组件测试先例**（tests/renderer 只测纯逻辑模块）→ 可测逻辑抽纯函数进
   `src/renderer/copy-path.ts`；交互断言走 e2e（Playwright 读真剪贴板）。
5. **M56 红线**：renderer 可 import 的模块不得带 node 内建 → `copy-path.ts` 只 import
   `../core/types` 的**类型**（type-only import 安全，library-view.ts 已有先例）。

## 设计决定

- **右键菜单四项**：阅读 / 文件夹 / 📋 复制路径 / 删除（删除带二次确认）。
  PRD 字面是「右键菜单加『📋 复制路径』一项」，但右键菜单是新建控件，只放一项不符合平台惯例；
  四项复用与 hover 按钮**同一组 handler**（`onRead/onReveal/onCopyPath/onDelete`），不产生第二套逻辑。
  PRD 验收只钉「复制路径项存在 + 与 hover 并存」，四项属于 plan 层具体化，安哥可一句话砍回单项。
- **「多选只复制所在那篇」的结构保证**：`onCopyPath` 在 `Library.tsx` 的 map 闭包里绑定该篇 `m`，
  不读 `sel`；纯函数 `copyPathText(meta)` 输入只有 meta。单测钉住前者、结构保证后者。
- **toast 文案**：成功「已复制」、失败「复制失败：`<msg>`」（PRD 原文；antd `message` 与全库一致）。

## T1 · 纯函数 + 单测（TDD 红→绿）

**新文件 `src/renderer/copy-path.ts`**：

```ts
import type { ArticleMeta } from '../core/types'

// 复制到剪贴板的文本：meta.dir 本身就是绝对路径（types.ts:39），
// 不拼接 libraryRoot——拼接反而会在 Windows 上引入分隔符问题。
export function copyPathText(meta: ArticleMeta): string {
  return meta.dir
}

export interface CardMenuItem {
  key: 'read' | 'reveal' | 'copy-path' | 'delete'
  label: string
  danger?: boolean
  disabled?: boolean
}

// 卡片右键菜单内容（与 hover 按钮同一组动作，发现性补充）。
export function cardMenuItems(readable: boolean): CardMenuItem[] {
  return [
    { key: 'read', label: '阅读', disabled: !readable },
    { key: 'reveal', label: '文件夹' },
    { key: 'copy-path', label: '📋 复制路径' },
    { key: 'delete', label: '删除', danger: true },
  ]
}
```

**新文件 `tests/renderer/copy-path.test.ts`**（vitest，参照 tests/renderer/library-view.test.ts 风格）：

```ts
import { describe, it, expect } from 'vitest'
import { copyPathText, cardMenuItems } from '../../src/renderer/copy-path'
import type { ArticleMeta } from '../../src/core/types'

const meta = { id: 'x', title: 't', dir: '/Users/a/Documents/wx-kit/2026-09-11-foo' } as ArticleMeta

describe('copyPathText', () => {
  it('返回该篇 meta.dir 本身（文本来源只认 meta，与任何选中集无关）', () => {
    const other = { ...meta, id: 'y', dir: '/Users/a/Documents/wx-kit/2026-09-10-bar' }
    expect(copyPathText(meta)).toBe(meta.dir)
    expect(copyPathText(other)).toBe(other.dir)   // 两篇各自独立 → 多选不串
  })
})

describe('cardMenuItems', () => {
  it('含 📋 复制路径，且四个动作齐全', () => {
    const keys = cardMenuItems(true).map((i) => i.key)
    expect(keys).toEqual(['read', 'reveal', 'copy-path', 'delete'])
    expect(cardMenuItems(true).find((i) => i.key === 'copy-path')?.label).toBe('📋 复制路径')
  })
  it('不可读文章 read 项 disabled', () => {
    expect(cardMenuItems(false).find((i) => i.key === 'read')?.disabled).toBe(true)
  })
})
```

验证：`npm test -- tests/renderer/copy-path.test.ts` 先红（模块不存在）后绿。

## T2 · ArticleRow 列表操作列加常驻按钮

`src/renderer/components/ArticleRow.tsx`：

- Props 加 `onCopyPath: () => void`。
- `.lacts` 内「文件夹」与「删除」之间插入：

```tsx
<button data-testid="row-copy-path" onClick={onCopyPath}>📋 复制路径</button>
```

（现有按钮无 emoji，此按钮按 PRD 原文带 📋；若视觉评审觉得突兀，全库按钮统一去 emoji 是另一个话题，本版不动。）

## T3 · ArticleCard 右键菜单

`src/renderer/components/ArticleCard.tsx`：

- Props 加 `onCopyPath: () => void`。
- 用 antd `Dropdown` 包裹最外层卡片 div：

```tsx
import { Dropdown, Modal } from 'antd'
import { cardMenuItems } from '../copy-path'

const menu = {
  items: cardMenuItems(readable).map((i) => ({
    key: i.key, label: i.label, danger: i.danger, disabled: i.disabled,
  })),
  onClick: ({ key, domEvent }: { key: string; domEvent: React.SyntheticEvent }) => {
    domEvent.stopPropagation()          // 不触发卡片单击选中
    if (key === 'read' && readable) onRead()
    else if (key === 'reveal') onReveal()
    else if (key === 'copy-path') onCopyPath()
    else if (key === 'delete') {
      Modal.confirm({
        title: '删除该文章？', content: '磁盘文件将一并删除',
        okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
        onOk: onDelete,
      })
    }
  },
}

return (
  <Dropdown menu={menu} trigger={['contextMenu']}>
    <div className={...} data-testid="article-card" ...>
      ...原内容不变...
    </div>
  </Dropdown>
)
```

- 右键菜单删除与 hover 按钮删除共用 `onDelete`；hover 区的 Popconfirm 保持原样（并存不替换）。
- 菜单 `data-testid`：Dropdown 渲染到 body，用 antd 默认 class 定位即可，e2e 里以文案 `📋 复制路径` 定位。

## T4 · Library.tsx 接线

`src/renderer/pages/Library.tsx`：

```ts
import { copyPathText } from '../copy-path'

const copyPath = async (m: ArticleMeta) => {
  try { await api.copyText(copyPathText(m)); message.success('已复制') }
  catch (e) { message.error('复制失败：' + (e as Error).message) }
}
```

- `renderCards`：`onCopyPath={() => copyPath(m)}` 传给 ArticleCard。
- `renderRows`：同样传给 ArticleRow。
- 闭包绑定该篇 `m`、不读 `sel`——「多选只复制所在那篇」由结构保证（PRD 验收第 4 条）。

## T5 · e2e 断言（tests/e2e/gui.e2e.mjs 增补）

在文库就绪（fixture 三篇）后新增一段：

```js
// M59 R1: 复制路径 —— 列表按钮 + 卡片右键菜单,剪贴板读真值
const readClipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())

// 卡片视图右键 → 菜单含「📋 复制路径」→ 点击 → 剪贴板 = 该篇绝对 dir
await win.locator('[data-testid="article-card"]').first().click({ button: 'right' })
await win.locator('.ant-dropdown-menu-item', { hasText: '📋 复制路径' }).click()
const clip1 = await readClipboard()
assert(clip1.startsWith(libRoot), `剪贴板应为文库内绝对路径,实际: ${clip1}`)
await win.waitForSelector('.ant-message :text("已复制")', { timeout: 3000 })

// 多选两篇后再对第一篇右键复制 → 仍是第一篇路径(不与 sel 耦合)
await win.locator('[data-testid="article-card"]').nth(0).click()
await win.locator('[data-testid="article-card"]').nth(1).click()
await win.locator('[data-testid="article-card"]').first().click({ button: 'right' })
await win.locator('.ant-dropdown-menu-item', { hasText: '📋 复制路径' }).click()
assert((await readClipboard()) === clip1, '多选状态下复制应仍作用于右键所在篇')

// 切列表视图 → 行尾常驻「📋 复制路径」按钮
await win.locator('[data-testid="view-toggle-list"]').click()   // 以实际切换按钮 testid 为准
await win.locator('[data-testid="row-copy-path"]').first().click()
assert((await readClipboard()).startsWith(libRoot), '列表视图复制路径同上')

// hover 三按钮仍在(右键菜单不替换既有入口)
assert(await win.locator('[data-testid="card-read"]').count() > 0, 'hover 阅读按钮保留')
```

注：`libRoot` 用 e2e 现有的临时文库根变量（现有断言已有等价值，按现场变量名对齐）；
列表切换按钮的 selector 以实现时实际 testid 为准（若无 testid 顺手补一个，属本里程碑范围）。

## T6 · 收尾

1. PRD §3 R1 措辞修正：「复制内容 = `meta.dir`（本身就是绝对路径，见 types.ts:39）」——验收条款不动。
2. `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`、`npm run test:e2e` 全绿。
3. devlog 增补 M59 小节（本里程碑随 v0.11.0 合并记，不单独开 §）。
4. feat/m59 → 合 main → 删分支；commit 英文；**不 push、不打 tag**（v0.11.0 整版再发）。

## 验收对照（PRD §6 R1）

| PRD 条款 | 落点 |
|---|---|
| 卡片右键菜单含「📋 复制路径」，剪贴板为绝对路径，toast | T3 + T5 |
| 右键菜单与 hover 按钮并存不替换 | T3 + T5 末条断言 |
| 列表操作列常驻按钮 | T2 + T5 |
| 多选只复制所在篇（单测钉住不与 sel 耦合） | T1 单测 + T4 结构 + T5 多选场景 |
| CLI 不变 | 零改动，无需断言 |
