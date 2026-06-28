# M18 — 首启建 PATH 软链(macOS + Linux)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** macOS/Linux 首次启动 GUI 时,一次性引导用户在 `~/bin` 为 `wx-kit` 建 PATH 软链(`~/bin` 不在 PATH 时再引导写入 shell profile);设置页提供随时重建入口;Windows 不触发。

**Architecture:** 软链/PATH 的纯文件逻辑放主进程服务 `electron/services/cli-link.ts`(参数全注入,可单测);`ipc.ts` 用真实 `homedir()`/`process.execPath`/`process.env` 装配后经 IPC 暴露;renderer 一个 `CliLinkPrompt` 组件挂在 `MainLayout`,首启自检后弹一次性 Antd Modal;`AppSettings` 加 `cliLinkPrompted` 记「已问过」。

**Tech Stack:** TypeScript、Node fs、Electron 主进程/IPC、React + Antd、vitest、Playwright(手验)。

## Global Constraints

- 仅 `process.platform ∈ {darwin, linux}` 触发软链逻辑与 UI;Windows 上 `cliLink:status.supported=false`,不弹 Modal、设置页入口隐藏。
- 软链目标 = `process.execPath`(打包后即 `…/Contents/MacOS/wx-kit`,双模式入口)。软链目录默认 `~/bin`。
- 不打扰:无论接受/忽略,首启后置 `settings.cliLinkPrompted=true`,不再每次弹;设置页入口绕过该标志。
- `src/core/` 不得 import electron;`electron/services/cli-link.ts` 纯 Node fs、无 electron,便于单测。
- 与用户交流用中文;代码/commit 用英文;改完跑 `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`。
- UI 验证须用真实 userData 驱动到真实态(见记忆 wx-kit-ui-verify-real-session)。
- 需求与验收:`docs/PRD-v0.5.0.md` §3 R3 / §4 R3。设计:spec M18。

## File Structure

- Modify: `electron/services/settings.ts` — `AppSettings` 加 `cliLinkPrompted: boolean`,defaults `false`。
- Modify: `tests/electron/settings.test.ts` — 三处全量 `toEqual` 加该字段 + 新默认断言。
- Create: `electron/services/cli-link.ts` — `linkStatus/createLink/pathContains/ensureInProfile/profilePathFor`。
- Test: `tests/electron/cli-link.test.ts`。
- Modify: `electron/ipc.ts` — 加 `cliLink:status/create/addToPath` 三处理器。
- Modify: `src/renderer/api.ts` — `WxApi` 加三方法 + 类型;`electron/preload.ts` — 三桥接。
- Create: `src/renderer/components/CliLinkPrompt.tsx`;Modify: `src/renderer/layouts/MainLayout.tsx` 挂载。
- Modify: `src/renderer/pages/Settings.tsx` — 「命令行快捷方式」区块。

---

### Task 1: 设置加 `cliLinkPrompted` 字段

**Files:**
- Modify: `electron/services/settings.ts:9-19,27-39`
- Test: `tests/electron/settings.test.ts:15,22,29` + 新用例

- [ ] **Step 1: 改失败测试**(先让断言反映新字段)

在 `tests/electron/settings.test.ts` 三处全量 `toEqual({...})` 对象里(第 15、22、29 行)各加 `cliLinkPrompted: false,`。并在文件末尾 describe 内追加:

```ts
  it('defaults cliLinkPrompted to false and persists true', async () => {
    const s = new SettingsService(dir, '/default/lib')
    expect((await s.get()).cliLinkPrompted).toBe(false)
    await s.save({ cliLinkPrompted: true })
    expect((await new SettingsService(dir, '/default/lib').get()).cliLinkPrompted).toBe(true)
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/electron/settings.test.ts`
Expected: FAIL — defaults 缺 `cliLinkPrompted`。

- [ ] **Step 3: 写实现**

`electron/services/settings.ts`:`AppSettings` 接口加一行(在 `subscriptionIntervalHours` 后):

```ts
  subscriptionIntervalHours: number
  cliLinkPrompted: boolean
```

`defaults()` 返回对象加一行(在 `subscriptionIntervalHours: 6,` 后):

```ts
      subscriptionIntervalHours: 6,
      cliLinkPrompted: false,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/electron/settings.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add electron/services/settings.ts tests/electron/settings.test.ts
git commit -m "feat(settings): add cliLinkPrompted flag (default false)"
```

---

### Task 2: 软链纯逻辑服务 `cli-link`

**Files:**
- Create: `electron/services/cli-link.ts`
- Test: `tests/electron/cli-link.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type LinkStatus = 'linked' | 'unlinked' | 'conflict'
  function linkStatus(linkPath: string, target: string): Promise<LinkStatus>
  function createLink(linkDir: string, linkPath: string, target: string, force?: boolean): Promise<void>
  function pathContains(dir: string, pathEnv: string | undefined): boolean
  function ensureInProfile(profilePath: string, line?: string): Promise<'added' | 'present'>
  function profilePathFor(shell: string | undefined, home: string): string
  ```

- [ ] **Step 1: 写失败测试**

```ts
// tests/electron/cli-link.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { linkStatus, createLink, pathContains, ensureInProfile, profilePathFor } from '../../electron/services/cli-link'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wxk-link-')) })

describe('linkStatus', () => {
  it('unlinked when missing', async () => {
    expect(await linkStatus(join(dir, 'wx-kit'), '/target')).toBe('unlinked')
  })
  it('linked when symlink points to target', async () => {
    const lp = join(dir, 'wx-kit'); symlinkSync('/target', lp)
    expect(await linkStatus(lp, '/target')).toBe('linked')
  })
  it('conflict when symlink points elsewhere', async () => {
    const lp = join(dir, 'wx-kit'); symlinkSync('/other', lp)
    expect(await linkStatus(lp, '/target')).toBe('conflict')
  })
  it('conflict when a regular file occupies the path', async () => {
    const lp = join(dir, 'wx-kit'); writeFileSync(lp, 'x')
    expect(await linkStatus(lp, '/target')).toBe('conflict')
  })
})

describe('createLink', () => {
  it('creates dir + symlink to target', async () => {
    const ld = join(dir, 'bin'); const lp = join(ld, 'wx-kit')
    await createLink(ld, lp, '/target')
    expect(await linkStatus(lp, '/target')).toBe('linked')
  })
  it('force overwrites a conflicting entry', async () => {
    const ld = join(dir, 'bin'); const lp = join(ld, 'wx-kit')
    await createLink(ld, lp, '/old')
    await createLink(ld, lp, '/target', true)
    expect(await linkStatus(lp, '/target')).toBe('linked')
  })
})

describe('pathContains', () => {
  it('matches exact dir among PATH entries', () => {
    expect(pathContains('/home/u/bin', `/usr/bin:/home/u/bin:/bin`)).toBe(true)
    expect(pathContains('/home/u/bin', `/usr/bin:/bin`)).toBe(false)
    expect(pathContains('/home/u/bin', undefined)).toBe(false)
  })
})

describe('ensureInProfile', () => {
  it('adds the export line once, idempotent', async () => {
    const p = join(dir, '.zshrc')
    expect(await ensureInProfile(p)).toBe('added')
    expect(await ensureInProfile(p)).toBe('present')
    const lines = readFileSync(p, 'utf-8').split('\n').filter((l) => l.includes('export PATH'))
    expect(lines).toHaveLength(1)
  })
})

describe('profilePathFor', () => {
  it('maps shell to rc file', () => {
    expect(profilePathFor('/bin/zsh', '/h')).toBe(join('/h', '.zshrc'))
    expect(profilePathFor('/bin/bash', '/h')).toBe(join('/h', '.bashrc'))
    expect(profilePathFor(undefined, '/h')).toBe(join('/h', '.profile'))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/electron/cli-link.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: 写实现**

```ts
// electron/services/cli-link.ts
// 命令行软链 + PATH 的纯文件逻辑(无 electron,参数全注入,可单测)。
import { symlink, mkdir, readlink, readFile, appendFile, unlink } from 'node:fs/promises'
import { join, delimiter } from 'node:path'

export type LinkStatus = 'linked' | 'unlinked' | 'conflict'

const PROFILE_LINE = 'export PATH="$HOME/bin:$PATH"'

/** linkPath 不存在=unlinked;是指向 target 的 symlink=linked;否则(指别处或普通文件)=conflict。 */
export async function linkStatus(linkPath: string, target: string): Promise<LinkStatus> {
  try {
    const cur = await readlink(linkPath)
    return cur === target ? 'linked' : 'conflict'
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return 'unlinked'
    if (code === 'EINVAL' || code === 'UNKNOWN') return 'conflict'   // 存在但不是 symlink
    throw e
  }
}

/** 建 linkDir 后把 linkPath 软链到 target;force=true 先删占位项再建。 */
export async function createLink(linkDir: string, linkPath: string, target: string, force = false): Promise<void> {
  await mkdir(linkDir, { recursive: true })
  if (force) { try { await unlink(linkPath) } catch { /* 无占位项 */ } }
  await symlink(target, linkPath)
}

/** dir 是否作为完整一项出现在 PATH 里。纯函数。 */
export function pathContains(dir: string, pathEnv: string | undefined): boolean {
  if (!pathEnv) return false
  return pathEnv.split(delimiter).some((p) => p === dir)
}

/** 幂等地把 export 行追加进 profile;已存在则不重复加。 */
export async function ensureInProfile(profilePath: string, line: string = PROFILE_LINE): Promise<'added' | 'present'> {
  let content = ''
  try { content = await readFile(profilePath, 'utf-8') } catch { /* 新文件 */ }
  if (content.split('\n').some((l) => l.trim() === line)) return 'present'
  const prefix = content.length && !content.endsWith('\n') ? '\n' : ''
  await appendFile(profilePath, `${prefix}${line}\n`)
  return 'added'
}

/** 按 $SHELL 选 rc 文件:zsh→.zshrc、bash→.bashrc、其它→.profile。纯函数。 */
export function profilePathFor(shell: string | undefined, home: string): string {
  if (shell?.includes('zsh')) return join(home, '.zshrc')
  if (shell?.includes('bash')) return join(home, '.bashrc')
  return join(home, '.profile')
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/electron/cli-link.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add electron/services/cli-link.ts tests/electron/cli-link.test.ts
git commit -m "feat(cli-link): pure symlink/PATH/profile logic with tests"
```

---

### Task 3: IPC 处理器 + api/preload 桥接

**Files:**
- Modify: `electron/ipc.ts`(import + 三处理器)
- Modify: `src/renderer/api.ts`(类型 + WxApi 三方法)
- Modify: `electron/preload.ts`(三桥接)

**Interfaces:**
- Produces(`WxApi`):
  ```ts
  cliLinkStatus(): Promise<CliLinkInfo>
  cliLinkCreate(force: boolean): Promise<{ status: CliLinkStatus }>
  cliLinkAddToPath(): Promise<{ profilePath: string; result: 'added' | 'present' }>
  ```
  其中 `type CliLinkStatus = 'linked' | 'unlinked' | 'conflict'`;`interface CliLinkInfo { supported: boolean; status: CliLinkStatus; inPath: boolean; dir: string }`。

- [ ] **Step 1: 加 IPC 处理器**

`electron/ipc.ts`:文件头 import 区加:

```ts
import { homedir } from 'node:os'
import { linkStatus, createLink, pathContains, ensureInProfile, profilePathFor } from './services/cli-link'
```

在 `registerIpc(...)` 体内(`shell:reveal` 处理器附近)加:

```ts
  const CLI_LINK_SUPPORTED = process.platform === 'darwin' || process.platform === 'linux'
  const cliLinkDir = () => join(homedir(), 'bin')
  const cliLinkPath = () => join(cliLinkDir(), 'wx-kit')

  ipcMain.handle('cliLink:status', async () => {
    if (!CLI_LINK_SUPPORTED) return { supported: false, status: 'unlinked', inPath: false, dir: cliLinkDir() }
    return {
      supported: true,
      status: await linkStatus(cliLinkPath(), process.execPath),
      inPath: pathContains(cliLinkDir(), process.env.PATH),
      dir: cliLinkDir(),
    }
  })
  ipcMain.handle('cliLink:create', async (_e, force: boolean) => {
    await createLink(cliLinkDir(), cliLinkPath(), process.execPath, force)
    return { status: await linkStatus(cliLinkPath(), process.execPath) }
  })
  ipcMain.handle('cliLink:addToPath', async () => {
    const profilePath = profilePathFor(process.env.SHELL, homedir())
    const result = await ensureInProfile(profilePath)
    return { profilePath, result }
  })
```

- [ ] **Step 2: 扩展 api.ts**

`src/renderer/api.ts`:在 `WxApi` 接口上方加类型导出:

```ts
export type CliLinkStatus = 'linked' | 'unlinked' | 'conflict'
export interface CliLinkInfo { supported: boolean; status: CliLinkStatus; inPath: boolean; dir: string }
```

`WxApi` 接口内(`onSubscriptionDownloadProgress` 后)加:

```ts
  // —— M18 命令行软链 ——
  cliLinkStatus(): Promise<CliLinkInfo>
  cliLinkCreate(force: boolean): Promise<{ status: CliLinkStatus }>
  cliLinkAddToPath(): Promise<{ profilePath: string; result: 'added' | 'present' }>
```

- [ ] **Step 3: 扩展 preload.ts**

`electron/preload.ts`:`api` 对象末尾(`onSubscriptionDownloadProgress` 之后)加:

```ts
  cliLinkStatus: () => ipcRenderer.invoke('cliLink:status'),
  cliLinkCreate: (force) => ipcRenderer.invoke('cliLink:create', force),
  cliLinkAddToPath: () => ipcRenderer.invoke('cliLink:addToPath'),
```

- [ ] **Step 4: 类型检查 + lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 全绿(WxApi 与 preload 实现一致,缺一会 tsc 报错)。

- [ ] **Step 5: 提交**

```bash
git add electron/ipc.ts src/renderer/api.ts electron/preload.ts
git commit -m "feat(cli-link): IPC + api/preload bridge for status/create/addToPath"
```

---

### Task 4: 首启 Modal 组件 + 挂载

**Files:**
- Create: `src/renderer/components/CliLinkPrompt.tsx`
- Modify: `src/renderer/layouts/MainLayout.tsx`

- [ ] **Step 1: 写组件**

```tsx
// src/renderer/components/CliLinkPrompt.tsx
import { useEffect, useState } from 'react'
import { Modal, message } from 'antd'
import { api } from '../api'
import type { CliLinkInfo } from '../api'

// 首启一次性引导:平台支持 + 未问过 + 未建链 → 弹窗。无论接受/忽略都记 cliLinkPrompted。
export default function CliLinkPrompt() {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<CliLinkInfo | null>(null)

  useEffect(() => {
    (async () => {
      const i = await api.cliLinkStatus()
      if (!i.supported || i.status === 'linked') return
      if ((await api.getSettings()).cliLinkPrompted) return
      setInfo(i); setOpen(true)
    })().catch(() => { /* 引导失败不阻塞应用 */ })
  }, [])

  const dismiss = async () => { await api.saveSettings({ cliLinkPrompted: true }); setOpen(false) }

  const create = async () => {
    try {
      await api.cliLinkCreate(info?.status === 'conflict')
      if (info && !info.inPath) {
        const r = await api.cliLinkAddToPath()
        message.success(`已创建快捷方式，并将 ~/bin 写入 ${r.profilePath}，重开终端后生效`)
      } else {
        message.success('已创建命令行快捷方式，可在终端运行 wx-kit')
      }
    } catch (e) {
      message.error('创建失败：' + (e as Error).message)
    } finally {
      await dismiss()
    }
  }

  if (!info) return null
  return (
    <Modal open={open} title="为 wx-kit 创建命令行快捷方式？"
      okText="创建" cancelText="暂不" onOk={create} onCancel={dismiss}
      data-testid="cli-link-modal">
      <p>创建后可在终端直接运行 <code>wx-kit …</code>，供 AI agent 调用。</p>
      <p className="faint">
        将在 <code>{info.dir}</code> 下创建指向应用的软链
        {info.status === 'conflict' && '（该位置已有同名文件，将被覆盖）'}
        {!info.inPath && '；并把 ~/bin 加入 PATH（写入 shell 配置）'}。
      </p>
    </Modal>
  )
}
```

- [ ] **Step 2: 挂载到 MainLayout**

`src/renderer/layouts/MainLayout.tsx`:头部 import 加 `import CliLinkPrompt from '../components/CliLinkPrompt'`;把渲染根 `<div ... data-testid="app-shell">` 内 `<Outlet />` 上方加一行 `<CliLinkPrompt />`:

```tsx
      <Outlet />
      <CliLinkPrompt />
```

- [ ] **Step 3: 类型检查 + lint + 构建**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: 全绿、构建出产物。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/components/CliLinkPrompt.tsx src/renderer/layouts/MainLayout.tsx
git commit -m "feat(cli-link): first-run modal prompting to create the PATH symlink"
```

---

### Task 5: 设置页「命令行快捷方式」区块

**Files:**
- Modify: `src/renderer/pages/Settings.tsx`

- [ ] **Step 1: 加状态与处理器**

`src/renderer/pages/Settings.tsx`:在 `const [s, setS] = useState<AppSettings | null>(null)` 下加:

```tsx
  const [cliLink, setCliLink] = useState<Awaited<ReturnType<typeof api.cliLinkStatus>> | null>(null)
  useEffect(() => { api.cliLinkStatus().then(setCliLink) }, [])
```

在 `rebuildIndex` 函数后加:

```tsx
  const createCliLink = async () => {
    try {
      await api.cliLinkCreate(cliLink?.status === 'conflict')
      if (cliLink && !cliLink.inPath) {
        const r = await api.cliLinkAddToPath()
        message.success(`已创建，并将 ~/bin 写入 ${r.profilePath}，重开终端生效`)
      } else {
        message.success('已创建命令行快捷方式')
      }
      setCliLink(await api.cliLinkStatus())
    } catch (e) { message.error('创建失败：' + (e as Error).message) }
  }
```

- [ ] **Step 2: 加区块**(在「订阅」`setting-block` 之后、`surface` 闭合 `</div>` 之前;仅 macOS/Linux 显示)

```tsx
          {cliLink?.supported && (
            <div className="setting-block">
              <div className="setting-label">命令行快捷方式</div>
              <div className="setting-hint">
                在 <code>{cliLink.dir}</code> 创建指向应用的软链，便于在终端运行 <code>wx-kit</code>（供 AI agent 调用）。
                当前状态：{cliLink.status === 'linked' ? '已创建' : cliLink.status === 'conflict' ? '该位置被占用（创建将覆盖）' : '未创建'}
                {!cliLink.inPath && '；~/bin 不在 PATH，创建时会引导写入 shell 配置'}。
              </div>
              <Button style={{ marginTop: 8 }} onClick={createCliLink} data-testid="set-cli-link">
                {cliLink.status === 'linked' ? '重新创建' : '创建命令行快捷方式'}
              </Button>
            </div>
          )}
```

- [ ] **Step 3: 类型检查 + lint + 构建**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/pages/Settings.tsx
git commit -m "feat(cli-link): settings page section to (re)create the CLI shortcut"
```

---

### Task 6: 端到端手验(真实 GUI,隔离 HOME 防污染)

> 软链会真实写 `~/bin` 与 `~/.zshrc`,**手验须在隔离临时 HOME 下跑**,别污染开发机(见记忆 wx-kit-ui-verify-real-session 用真实 session,但此处额外用临时 HOME)。无代码改动。

- [ ] **Step 1: 全新 userData + 临时 HOME 首启验证弹窗**

Run(mac):

```bash
TMPHOME=$(mktemp -d)
HOME="$TMPHOME" npx electron .
```
期望:GUI 启动后弹出「为 wx-kit 创建命令行快捷方式？」Modal(因临时 HOME 下无 `~/bin/wx-kit` 链、settings 全新 `cliLinkPrompted=false`)。

- [ ] **Step 2: 接受 → 验证软链与 PATH 写入**

在 Modal 点「创建」。退出后检查:

```bash
ls -l "$TMPHOME/bin/wx-kit"          # 应是指向 .../MacOS/wx-kit(开发态为 electron execPath)的 symlink
grep 'export PATH="$HOME/bin' "$TMPHOME/.zshrc"   # 若 ~/bin 原不在 PATH,应已写入一行
```

- [ ] **Step 3: 重启不再弹**

Run: `HOME="$TMPHOME" npx electron .`
期望:不再弹 Modal(`cliLinkPrompted=true`)。手动进「设置」→ 见「命令行快捷方式」区块状态为「已创建」,点「重新创建」可成功。

- [ ] **Step 4: 平台门**

确认 Windows(若可测)不弹 Modal、设置页无此区块(`supported=false`)。清理:`rm -rf "$TMPHOME"`。

- [ ] **Step 5: 勾验收**

对照 `docs/PRD-v0.5.0.md` §4 R3 逐条勾。

---

## Self-Review

- **Spec 覆盖**:R3 的 `cli-link` 服务(Task 2)、首启一次性 Modal+不打扰(Task 4 + `cliLinkPrompted` Task 1)、`~/bin` + PATH 引导写 profile(Task 2 `ensureInProfile`/`profilePathFor` + Task 3 装配)、conflict 覆盖(Task 2 `createLink force` + Modal/设置页提示)、设置页重建入口(Task 5)、Windows 不做(Task 3 `supported=false` 门 + Task 4/5 据此隐藏)。全覆盖。
- **占位符**:无;纯逻辑全 TDD,UI/IPC 给出完整代码 + 真实环境手验步骤。
- **类型一致**:`CliLinkInfo`/`CliLinkStatus`、`cliLinkStatus/cliLinkCreate/cliLinkAddToPath` 在 api.ts、preload.ts、ipc.ts、两处 renderer 引用一致;`linkStatus/createLink/pathContains/ensureInProfile/profilePathFor` 签名在服务与 ipc 装配处一致。
- **注意**:Task 1 必须先改 `settings.test.ts` 三处全量 `toEqual`,否则加字段后既有断言会红。
