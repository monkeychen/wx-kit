# M57（v0.10.3）实现计划：wrapper 临时位置守卫 + 文库下拉名称 + 识别反馈

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/PRD-v0.10.3.md` 的 R1–R3：CLI wrapper 拒绝临时位置、文库筛选下拉显示公众号名称（含跳转空态）、订阅页「识别」全程有反馈。

**Architecture:** R1 把「临时位置」判定抽为 `cli-link.ts` 纯函数，主进程两个 IPC handler（status 的 legacy 自愈、create 手动重建）统一拦截，渲染层两处调用点（Settings、CliLinkPrompt）按 `transient` 标记给引导话术。R2 把文库公众号下拉从「名称数组」升级为 `{id, name}` 选项（身份作 value、名称作 label），跳转链接补传显示名以覆盖「该号 0 篇」空态。R3 纯渲染层状态：`searching` state + 三条静默路径补话术。

**Tech Stack:** Electron 42 主进程 IPC + React/Antd v6 渲染层 + vitest + Playwright Electron e2e。

**Spec:** `docs/PRD-v0.10.3.md`（§3 需求、§4 交互约定、§6 验收清单）

## Global Constraints（每个任务默认继承）

- **渲染层 import 红线**：`src/renderer/` 只许 import 零 node 依赖的纯 core 模块（`import type` 除外）。`normalizeAccountKey` 必须从 `src/core/weread/book-id` 引（不能经 `core/subscriptions`，其依赖 node:fs 会把 require shim 摇进渲染 bundle 导致白屏——M56 T4 实录）。
- **Antd v6 陷阱**：两个汉字按钮文本间自动插空格（"阅 读"），e2e 选择器用 `:has-text("识 别")` 或按 `data-testid` 定位。
- 纯逻辑 TDD；代码注释以中文为主（与全库一致）。
- commit message 用英文写进临时文件 `git commit -F`（防反引号命令替换）。
- 验证三件套：`npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`；e2e（`npm run test:e2e`）在 T5 统一跑。
- 不改 Windows CLI stdout、不做公式保真（PRD §5 非目标）。

## 现状核实表（2026-09-08 对源码核实）

| 落点 | 现状 | 与 PRD 的差异 |
|---|---|---|
| `electron/services/cli-link.ts` | 纯文件逻辑：`wrapperScript/linkStatus/createLink/pathContains/ensureInProfile/profilePathFor`，无临时位置概念 | 新增 `isTransientExecPath` |
| `electron/ipc.ts:131-150` | `cliLink:status` 仅在 `legacy` 时**自动**升级为 wrapper（不是 unlinked 自动建链）；`cliLink:create` 无条件执行 | 两处都要守卫；status 返回体加 `transient` |
| `src/renderer/api.ts:33-34,105-106` | `CliLinkInfo` 四字段；`cliLinkCreate` 返回 `{status}` | 两处加可选 `transient?: boolean` |
| `src/renderer/pages/Settings.tsx:80-92,381-391` | `createCliLink` 调 `cliLinkCreate(conflict?)` 后无条件 success 提示 | transient 时改 warning 引导；CLI 区描述补永久说明 |
| `src/renderer/components/CliLinkPrompt.tsx` | 首启引导弹窗，`create` 同样无条件 success；弹出条件只看 `supported`/`linked`/`cliLinkPrompted` | transient 时直接不弹（dev 用户不被无效引导打扰）；`create` 兜底 warning |
| `src/renderer/library-view.ts:20-26` | `accountsOf` 返回 `string[]`（纯名称），唯一调用点 `Library.tsx:65` | 替换为 `accountOptions` 返回 `{id,name}[]` |
| `src/renderer/pages/Library.tsx:29-32,184-185` | `account` 初始取 `?account=`；下拉 options value/label 都是名称；URL 随即被清（`useEffect` replace） | options 用 id/name；跳转补传 `&name=` 供空态显示；label 参数须在 URL 清除前取入 state |
| `src/renderer/pages/Subscriptions.tsx:88-93,325-326,385` | `search` 无 loading；空输入静默 return；零候选静默；跳转只传 `account=<fakeid>` | R3 三条反馈 + 跳转补 `&name=<nickname>` |
| `tests/e2e/gui.e2e.mjs` | mock（fixture server）对任何 cover 请求返回同一候选 → **e2e 造不出「零候选」响应**；73 行起 | 零候选话术靠实现评审，不进 e2e（mock 局限，验收清单注记）；空输入 warning 与 R2 下拉名称进 e2e |

## 任务

### Task 1: `isTransientExecPath` 纯函数（R1 核心）

**Files:**
- Modify: `electron/services/cli-link.ts`（文件末尾追加函数）
- Test: `tests/electron/cli-link.test.ts`（文件末尾追加 describe）

**Interfaces:**
- Produces: `isTransientExecPath(execPath: string, isPackaged: boolean): boolean` — Task 2 的两个 IPC handler 调用。

- [ ] **Step 1: 写失败测试**（`tests/electron/cli-link.test.ts` 末尾追加；import 行把 `isTransientExecPath` 加进既有的 `from '../../electron/services/cli-link'` 列表）

```ts
describe('isTransientExecPath', () => {
  it('dev（未打包）一律视为临时位置', () => {
    expect(isTransientExecPath('/any/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', false)).toBe(true)
    expect(isTransientExecPath('C:\\node\\electron.exe', false)).toBe(true)
  })
  it('正式安装路径不是临时位置', () => {
    expect(isTransientExecPath('/Applications/wx-kit.app/Contents/MacOS/wx-kit', true)).toBe(false)
    expect(isTransientExecPath('C:\\Users\\a\\AppData\\Local\\Programs\\wx-kit\\wx-kit.exe', true)).toBe(false)
  })
  it('构建输出目录（mac/win 形态）是临时位置', () => {
    expect(isTransientExecPath('/Users/a/proj/release/mac-arm64/wx-kit.app/Contents/MacOS/wx-kit', true)).toBe(true)
    expect(isTransientExecPath('C:\\proj\\release\\win-unpacked\\wx-kit.exe', true)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run tests/electron/cli-link.test.ts`，Expected: FAIL（`isTransientExecPath` 未导出）。

- [ ] **Step 3: 最小实现**（`electron/services/cli-link.ts` 末尾追加）

```ts
/**
 * execPath 是否处于「临时位置」：dev（未打包）或构建输出目录（路径含 release 段，mac/win 同判）。
 * 临时位置的产物会被下次打包/清理删掉，wrapper 指向它必然悬空（2026-09-04 实录：从 release/
 * 启动建链后 win 打包清目录，CLI 报 No such file or directory）。
 * 正式安装（/Applications、brew、%LOCALAPPDATA%\Programs）不含 release 段，不受影响。
 */
export function isTransientExecPath(execPath: string, isPackaged: boolean): boolean {
  if (!isPackaged) return true
  return /[/\\]release[/\\]/.test(execPath)
}
```

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2，Expected: 全 PASS。
- [ ] **Step 5: Commit** — `git add` 两文件，message：`feat(cli-link): transient exec path detection for wrapper guard (M57 T1)`（`-F` 临时文件）。

### Task 2: R1 接线——IPC 守卫 + 渲染层引导

**Files:**
- Modify: `electron/ipc.ts:7,129-149`（import、两个 handler）
- Modify: `src/renderer/api.ts:33-34,105-106`（类型）
- Modify: `src/renderer/pages/Settings.tsx:80-92,381-391`（createCliLink + CLI 区描述）
- Modify: `src/renderer/components/CliLinkPrompt.tsx`（弹出条件 + create 兜底）

**Interfaces:**
- Consumes: Task 1 的 `isTransientExecPath`。
- Produces: `CliLinkInfo.transient?: boolean`、`cliLinkCreate` 返回 `{ status; transient?: boolean }` —— Task 2 内的 Settings/CliLinkPrompt 消费，无跨任务依赖。

- [ ] **Step 1: api.ts 类型** — `CliLinkInfo` 加 `transient?: boolean`；`cliLinkCreate` 返回类型改 `Promise<{ status: CliLinkStatus; transient?: boolean }>`。

- [ ] **Step 2: ipc.ts 守卫** — import 行加 `isTransientExecPath`；`CLI_LINK_SUPPORTED` 定义之后加：

```ts
  // wrapper 指向临时位置的产物会在打包/清理后悬空——临时位置一律不写（PRD-v0.10.3 R1）
  const transientLink = () => isTransientExecPath(process.execPath, app.isPackaged)
```

`cliLink:status` handler：`legacy` 自愈分支改为 `if (status === 'legacy' && !transientLink()) { …原逻辑… }`（注释保留原说明，补一句「临时位置不写，保持现状等正式安装处理」）；返回对象加 `transient: transientLink()`。`cliLink:create` handler 改为：

```ts
  ipcMain.handle('cliLink:create', async (_e, force: boolean) => {
    if (!CLI_LINK_SUPPORTED) return { status: 'unlinked' as const }
    if (transientLink()) {
      // 拒绝创建但回报现状，渲染层据 transient 标记给引导话术
      return { status: await linkStatus(cliLinkPath(), process.execPath), transient: true as const }
    }
    await createLink(cliLinkDir(), cliLinkPath(), process.execPath, force)
    return { status: await linkStatus(cliLinkPath(), process.execPath) }
  })
```

- [ ] **Step 3: Settings.tsx** — `createCliLink` 开头改为先接返回值：

```ts
      const r = await api.cliLinkCreate(cliLink?.status === 'conflict')
      if (r.transient) {
        message.warning('当前从开发/构建目录运行，命令行入口暂不创建——请从正式安装的 wx-kit 启动后再试')
        return
      }
```

CLI 区描述（`cliLink?.supported` 块内、「当前状态」行之后）补一行：`{cliLink.transient && <div className="faint">当前从开发/构建目录运行，命令行入口暂不可创建；从正式安装的 wx-kit 启动后可用。</div>}`。

- [ ] **Step 4: CliLinkPrompt.tsx** — `useEffect` 的弹出条件加一条：`if (i.transient) return`（dev 下不弹引导）。`create` 里 `cliLinkCreate` 后加与 Step 3 相同的 `r.transient` 兜底 warning（话术同）后 `await dismiss()` 并 return。

- [ ] **Step 5: 验证** — `npm test`（既有断言不破）、`npx tsc --noEmit -p tsconfig.json`。Expected: 全绿。e2e 影响分析：e2e 跑在未打包 electron（`isPackaged=false`）→ transient 恒 true，但 e2e 已 seed `cliLinkPrompted: true`（Prompt 不弹）且无 CLI 创建断言，status 返回体加字段不破坏既有断言。

- [ ] **Step 6: Commit** — message：`feat(cli-link): refuse wrapper writes from transient launch locations (M57 T2)`（`-F` 临时文件）。

### Task 3: R2 文库下拉显示公众号名称

**Files:**
- Modify: `src/renderer/library-view.ts:20-26`（`accountsOf` → `accountOptions`）
- Modify: `src/renderer/pages/Library.tsx:29-32,65,184-185`
- Modify: `src/renderer/pages/Subscriptions.tsx:385`（跳转补 `&name=`）
- Test: `tests/renderer/library-view.test.ts`（追加 describe）

**Interfaces:**
- Produces: `accountOptions(list: ArticleMeta[]): AccountOption[]`，`AccountOption = { id: string; name: string }` — 本任务内 Library.tsx 消费。
- 移除: `accountsOf`（唯一调用点 Library.tsx 同步替换，无其他消费方）。

- [ ] **Step 1: 写失败测试**（`tests/renderer/library-view.test.ts` 追加；import 行把 `accountOptions` 加进列表，替换掉 `accountsOf`）

```ts
describe('accountOptions（R2：下拉 value 用身份、label 用名称）', () => {
  it('新条目：id=accountId，name=名称', () => {
    expect(accountOptions([mk({ id: 'n1', account: '猫笔刀', accountId: 'MP_WXS_123' })]))
      .toEqual([{ id: 'MP_WXS_123', name: '猫笔刀' }])
  })
  it('旧条目（无 accountId）：名称兼任 id（与旧下拉行为等价）', () => {
    expect(accountOptions([a])).toEqual([{ id: '猫笔刀', name: '猫笔刀' }])
  })
  it('混合库：同一号归并为一个选项，id 升级为真身份，保持首见序', () => {
    const old1 = mk({ id: 'o1', account: '猫笔刀' })
    const new1 = mk({ id: 'n1', account: '猫笔刀', accountId: 'MP_WXS_123' })
    const old2 = mk({ id: 'o2', account: '卡兹克' })
    expect(accountOptions([old1, new1, old2])).toEqual([
      { id: 'MP_WXS_123', name: '猫笔刀' },
      { id: '卡兹克', name: '卡兹克' },
    ])
  })
  it('同一身份、名称不同（改名前后）：归并为一个选项', () => {
    const before = mk({ id: 'r1', account: '旧名', accountId: 'MP_WXS_9' })
    const after = mk({ id: 'r2', account: '新名', accountId: 'MP_WXS_9' })
    expect(accountOptions([before, after])).toEqual([{ id: 'MP_WXS_9', name: '旧名' }])
  })
  it('空 account（未知公众号）不与具名号混排', () => {
    const unknown = mk({ id: 'u1', account: '' })
    expect(accountOptions([unknown, a])).toEqual([
      { id: '未知公众号', name: '未知公众号' },
      { id: '猫笔刀', name: '猫笔刀' },
    ])
  })
})
```

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run tests/renderer/library-view.test.ts`，Expected: FAIL（`accountOptions` 未导出）。

- [ ] **Step 3: 实现 `accountOptions`**（`library-view.ts` 中替换 `accountsOf`；归并 key 双轨注册——身份 key + 名称 key 都指向同一选项，混合库才能归并）

```ts
export interface AccountOption { id: string; name: string }

/**
 * 喂筛选下拉的公众号选项：value 用身份（accountId；旧条目缺失时以名称兼任，与旧下拉行为等价），
 * label 用名称。同一公众号按「身份 key + 名称 key」双轨归并——M56 跳转传身份、历史下拉传名称，
 * 混合库下同一号会以两种形态出现；保持首见序。
 */
export function accountOptions(list: ArticleMeta[]): AccountOption[] {
  const byKey = new Map<string, AccountOption>()
  const out: AccountOption[] = []
  for (const m of list) {
    const name = accountName(m)
    const keys = [normalizeAccountKey(name)]
    if (m.accountId) keys.push(normalizeAccountKey(m.accountId))
    const hit = keys.map((k) => byKey.get(k)).find(Boolean)
    if (!hit) {
      const opt: AccountOption = { id: m.accountId ?? name, name }
      for (const k of keys) byKey.set(k, opt)
      out.push(opt)
      continue
    }
    // 已有同号：id 从名称形态升级为真身份；名称从「未知公众号」升级为真名
    if (m.accountId && hit.id === hit.name) hit.id = m.accountId
    if (hit.name === '未知公众号' && name !== '未知公众号') hit.name = name
    for (const k of keys) byKey.set(k, hit)
  }
  return out
}
```

- [ ] **Step 4: Library.tsx 接线** — import 改 `accountOptions`；`const accounts = useMemo(() => accountOptions(all), [all])`；URL 清除前把显示名取进 state（`useEffect` 会 replace 掉 URL 参数）：

```tsx
  const [account, setAccount] = useState<string | null>(sp.get('account'))
  const [accountLabel] = useState<string | null>(sp.get('name'))
```

下拉（`account-select`）的 options 改为：

```tsx
            options={[{ value: '__all', label: '全部公众号' }, ...accounts.map((a) => ({ value: a.id, label: a.name })),
              ...(account && accountLabel && !accounts.some((x) => x.id === account) ? [{ value: account, label: accountLabel }] : [])]}
```

（末项覆盖「该号 0 篇」的专属空态场景：库里没有该号条目时下拉仍有名称可显示，否则裸 ID 复现。）

- [ ] **Step 5: Subscriptions.tsx 跳转补显示名**（`:385`）：

```tsx
                  onClick={() => navigate(`/library?account=${encodeURIComponent(a.fakeid)}&name=${encodeURIComponent(a.nickname)}`)}
```

- [ ] **Step 6: 验证** — `npx vitest run tests/renderer/library-view.test.ts` PASS；`npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json` 全绿。

- [ ] **Step 7: Commit** — message：`feat(library): account filter options use identity id with name label (M57 T3)`（`-F` 临时文件）。

### Task 4: R3 订阅页「识别」全程反馈

**Files:**
- Modify: `src/renderer/pages/Subscriptions.tsx:88-93,325-326`

**Interfaces:** 无跨任务接口（纯本页状态）。`api.mpSearch` 契约不变。

- [ ] **Step 1: search 函数改造**（`:88`；新增 `searching` state 紧挨既有 `candidates` state 声明）

```tsx
  const [searching, setSearching] = useState(false)
  const search = async () => {
    const name = kw.trim()
    if (!name) { message.warning('先粘贴该公众号任意一篇文章的链接'); return }
    setSearching(true)
    try {
      const r = await api.mpSearch(name)
      if (!r.ok) { message.error(r.error?.message ?? '识别失败'); setAuthExpired(r.error?.code === 'AUTH_REQUIRED'); return }
      const hits = r.list ?? []
      setCandidates(hits)
      // 成功但零候选（链接非公众号文章/已删）也是一条「点了没反应」的静默路径，必须给话术。
      // e2e mock 对任何 cover 请求都返回同一候选，造不出零候选——此分支由实现评审覆盖，不进 e2e。
      if (!hits.length) message.warning('未识别出公众号，请确认链接是公众号文章')
    } finally {
      setSearching(false)
    }
  }
```

- [ ] **Step 2: 控件接线**（`:325-326`）— Input 加 `disabled={searching}`；Button 加 `loading={searching}`（与「检查全部」按钮的既有模式一致）。

- [ ] **Step 3: 验证** — `npm test`、`npx tsc --noEmit -p tsconfig.json` 全绿（renderer 层无组件挂载测试先例，行为断言在 Task 5 的 e2e）。

- [ ] **Step 4: Commit** — message：`feat(subscriptions): feedback for every identify outcome (M57 T4)`（`-F` 临时文件）。

### Task 5: e2e 断言补齐 + 全量验证 + 真实启动验证 + devlog

**Files:**
- Modify: `tests/e2e/gui.e2e.mjs`（订阅页段 ~307 行前、M56 文库段 ~365 行后）
- Modify: `docs/devlog/wx-kit-vibe-coding.md`（M57 增补）
- Modify: `docs/PRD-v0.10.3.md`（§6 验收注记）

**Interfaces:** 无。

- [ ] **Step 1: R3 e2e 断言** — 订阅页段，在现有「粘贴文章链接识别」（`fill(subs-search-input)` 之前）插入：

```js
    // R3: 空输入点「识别」→ 引导话术，不发请求（mock 不变即可断言）
    await win.click('[data-testid="subs-search-btn"]')
    await win.waitForSelector('.ant-message-notice:has-text("先粘贴")', { timeout: 3000 })
    assert(true, '空输入识别给出引导话术')
```

- [ ] **Step 2: R2 e2e 断言** — M56 文库段（`library-account-empty` 断言之后）插入。该场景正是「该号 0 篇」空态：无 Task 3 的 `&name=` 传参时下拉只能显示裸 ID，此断言同时钉住传参与补项逻辑：

```js
    // R2: 跳转文库后筛选框显示公众号名称而非裸 ID（该号 0 篇的空态场景，名称来自跳转参数）
    const selText = await win.locator('[data-testid="account-select"] .ant-select-selection-item').innerText()
    assert(selText === '测试订阅号', `跳转文库后筛选框显示名称(实际:${selText})`)
```

- [ ] **Step 3: 跑 e2e** — `npm run test:e2e`。**必须读输出确认每条断言 ✓，exit code 0 不代表绿**（脚本会吞主流程异常，v0.10.2 实录过假绿）。Expected: 既有断言全过 + 新增两条 ✓。

- [ ] **Step 4: 全量验证** — `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`。Expected: 全绿。

- [ ] **Step 5: 真实启动验证（R1 的 release 态）** — `npm run build` 出包后，从 `release/mac-arm64/wx-kit.app` 启动 GUI：设置页 CLI 区应显示「临时位置」说明，点「创建命令行快捷方式」出 warning 且 `~/bin/wx-kit` 内容不被改写（验证前后 `cat ~/bin/wx-kit` 比对）。随后从 /Applications 正式安装启动一次，确认 CLI 区无临时说明、行为与现状一致。**注意：从 release 启动不会破坏现有 wrapper（T2 守卫生效），这正是要验证的点。**

- [ ] **Step 6: PRD §6 勾选 + devlog 增补** — 逐条勾验收（零候选一条注记「e2e mock 造不出零候选响应，由实现评审覆盖」）；devlog 按里程碑增补 M57 段（需求来源：阅读数 spike 证伪 + 三个小修；TDD 过程与坑）。

- [ ] **Step 7: Commit** — message：`test(e2e): pin M57 guard/name/feedback assertions; docs closeout (M57 T5)`（`-F` 临时文件）。

## Self-Review 记录

- **Spec 覆盖**：PRD §6 十二条 → R1 三态（T1 单测 + T5 Step 5 真实启动）、R2 跳转/手动/混合库（T3 单测 + T5 e2e）、R3 四条交互（T4 实现 + T5 空输入 e2e；零候选注记）、验证三件套（T5 Step 4）。无缺口。
- **类型一致**：`AccountOption{id,name}`、`CliLinkInfo.transient?`、`isTransientExecPath(string, boolean)` 各任务间签名一致；`accountOptions` 替换 `accountsOf` 已列移除项。
- **已知风险**：T3 下拉 options 变更后，e2e 既有的 `pickSelect('account-select','甲号')` 按 label 文本选择不受影响（label 仍是名称）；T2 守卫使 e2e 环境恒 transient，已核实 e2e 无 CLI 创建断言、Prompt 已被 seed 关闭。
