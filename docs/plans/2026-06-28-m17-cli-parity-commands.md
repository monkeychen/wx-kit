# M17 — CLI 能力补齐(文库/订阅/设置)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 CLI 补上 `library search`/`library remove`、`subscription list`/`subscription check-now`、`settings get`/`settings set`;让所有涉及库根的命令默认回落 `settings.libraryRoot`(GUI/CLI 同库);把 `runSubscriptionCheck` 从 `ipc.ts` 抽到可复用、可单测的服务。

**Architecture:** CLI 在 `runCli` 内构造 `SettingsService`(用 main.ts 注入的 `userDataDir`),`--out` 缺省时读 `settings.libraryRoot`。订阅检查编排抽到 `electron/services/subscription-check.ts`,依赖全注入(subs/session/mpFetch/downloadRefs/log/onEmit),`ipc.ts` 与 `src/cli/index.ts` 各自装配真实依赖后调用。设置写入的字符串→类型解析放纯函数 `electron/services/settings-cli.ts`。

**Tech Stack:** TypeScript、commander、vitest、Electron 主进程服务层。

## Global Constraints

- CLI 命令结果输出纯 JSON 到 stdout;退出码 0 成功 / 1 业务失败 / 2 参数或鉴权(沿用现状)。
- `src/core/` 不得 import electron 运行时。`electron/services/subscription-check.ts`、`settings-cli.ts` 属主进程侧;`subscription-check.ts` 仅 import core 纯模块与 types(不 import electron 运行时,便于单测);`settings-cli.ts` 纯函数无 electron。
- 与用户交流用中文;代码/commit message 用英文。
- 改完跑 `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`。
- **频控不重试**:订阅检查命中频控即跳过该号、下轮再来(`check-subscriptions.ts` 已实现,勿在 CLI 层加重试)。
- 需求与验收:`docs/PRD-v0.5.0.md` §3 R2 / §4 R2。设计:spec M17。
- 设置白名单(可由 CLI 写)= `libraryRoot, defaultFormats, historyRetentionDays, subscriptionAutoCheck, subscriptionCheckTime, subscriptionNewArticleAction, subscriptionScheduleMode, subscriptionIntervalHours`。**不开放** `listColumnWidths`(GUI 布局)与 `cliLinkPrompted`(M18 内部)。

## File Structure

- Modify: `src/cli/index.ts` — `runCli` 加 `opts.userDataDir`;`settingsFor()`/`resolveRoot()`;现有命令 `--out` 改缺省回落;新增 `library search/remove`、`subscription list/check-now`、`settings get/set`。
- Modify: `electron/main.ts:35` — `runCli(args, { version, userDataDir: app.getPath('userData') })`。
- Create: `electron/services/subscription-check.ts` — `runSubscriptionCheck(trigger, deps)`。
- Modify: `electron/ipc.ts:186-231,259` — 改用抽出的 `runSubscriptionCheck`。
- Create: `electron/services/settings-cli.ts` — `parseSettingAssignment(key, raw)`。
- Test: `tests/cli/cli-contract.test.ts`、`tests/electron/subscription-check.test.ts`、`tests/electron/settings-cli.test.ts`。

---

### Task 1: runCli 接 userDataDir + 库根默认回落设置

**Files:**
- Modify: `src/cli/index.ts`(`runCli` 签名、新增 helper、改 5 个命令的 `--out`)
- Modify: `electron/main.ts:35`
- Test: `tests/cli/cli-contract.test.ts`

**Interfaces:**
- Consumes: `runCli(argv, opts?)`(M16 已加 `version`)。
- Produces: `runCli(argv: string[], opts?: { version?: string; userDataDir?: string }): Promise<number>`;闭包内 `settingsFor()`、`resolveRoot(optOut?: string): Promise<string>`。

- [ ] **Step 1: 写失败测试**(加到 `tests/cli/cli-contract.test.ts`)

```ts
import { SettingsService } from '../../electron/services/settings'
// ... 文件已有其它 import

describe('CLI library root falls back to settings.libraryRoot', () => {
  it('library list without --out reads settings.libraryRoot', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'wxk-ud-'))
    const lib = mkdtempSync(join(tmpdir(), 'wxk-lib-'))
    await new SettingsService(userData, '/unused').save({ libraryRoot: lib })
    writeFileSync(join(lib, 'library.json'), JSON.stringify({
      version: 1, articles: [{ id: 'k', title: 'K', account: 'a', publishTime: '', sourceUrl: '', digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: join(lib, 'a') }],
    }))
    const code = await runCli(['library', 'list'], { userDataDir: userData })
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, items: [{ id: 'k' }] })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "falls back"`
Expected: FAIL — `library list` 无 `--out` 时现读硬编码 `~/Documents/wx-kit`,取不到 `k`。

- [ ] **Step 3: 改 runCli 签名 + 加 helper**

`src/cli/index.ts`:把 M16 改过的签名再加 `userDataDir`,并在 `program.configureOutput({...})` 之后、`let exitCode = 0` 之前插入 helper:

```ts
export async function runCli(argv: string[], opts: { version?: string; userDataDir?: string } = {}): Promise<number> {
  const program = new Command()
  program.name('wx-kit').description('微信百宝箱 CLI').exitOverride()
  program.version(opts.version ?? '0.0.0-dev', '-v, --version', '输出版本号')
  program.configureOutput({
    writeOut: (s) => process.stdout.write(s),
    writeErr: (s) => process.stderr.write(s),
  })

  const settingsFor = () =>
    new SettingsService(opts.userDataDir ?? join(homedir(), '.wx-kit'), defaultLibraryRoot())
  const resolveRoot = async (optOut?: string): Promise<string> =>
    optOut ?? (await settingsFor().get()).libraryRoot

  let exitCode = 0
```

加 import(文件头):

```ts
import { SettingsService } from '../../electron/services/settings'
```

> `opts.userDataDir` 由 main.ts 注入真实 `app.getPath('userData')`,与 GUI 同源;`'.wx-kit'` 仅为 opts 缺省时的安全兜底,实际运行不会用到。

- [ ] **Step 4: 改 5 个命令的 `--out` 缺省与用法**

对 `download`、`crawl`、`library list`、`library rebuild`、`library export`,把
`.option('-o, --out <dir>', '文章库根目录', defaultLibraryRoot())`
统一改为
`.option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')`(去掉第三参缺省),
并在各自 action 内,把对 `opts.out` 的使用替换为先 `const root = await resolveRoot(opts.out)`:

- `download` action:`const library = new Library(opts.out)` → `const root = await resolveRoot(opts.out)` 后 `const library = new Library(root)`;`deps` 里 `libraryRoot: opts.out` → `libraryRoot: root`。
- `crawl` action:同上,`new Library(opts.out)`→`new Library(root)`、`libraryRoot: opts.out`→`libraryRoot: root`(在 `const formats = parseFormats(...)` 附近先取 `const root = await resolveRoot(opts.out)`)。
- `library list` action:`new Library(opts.out)` → `new Library(await resolveRoot(opts.out))`。
- `library rebuild` action:`rebuildLibrary(opts.out)` → `rebuildLibrary(await resolveRoot(opts.out))`。
- `library export` action:`new Library(opts.out)` → `new Library(await resolveRoot(opts.out))`。

- [ ] **Step 5: 改 main.ts 注入 userDataDir**

`electron/main.ts:35`:

```ts
    const code = await runCli(args, { version: app.getVersion(), userDataDir: app.getPath('userData') })
```

- [ ] **Step 6: 跑测试确认通过 + 回归**

Run: `npx vitest run tests/cli/cli-contract.test.ts`
Expected: 新用例 PASS;原 `--out` 显式用例仍 PASS(显式 out 不读设置)。

- [ ] **Step 7: 提交**

```bash
git add src/cli/index.ts electron/main.ts tests/cli/cli-contract.test.ts
git commit -m "feat(cli): default library root to settings.libraryRoot when --out omitted"
```

---

### Task 2: 设置赋值解析纯函数 `settings-cli`

**Files:**
- Create: `electron/services/settings-cli.ts`
- Test: `tests/electron/settings-cli.test.ts`

**Interfaces:**
- Produces: `SETTABLE_KEYS: readonly string[]`;`parseSettingAssignment(key: string, raw: string): { ok: true; patch: Partial<AppSettings> } | { ok: false; error: string }`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/electron/settings-cli.test.ts
import { describe, it, expect } from 'vitest'
import { parseSettingAssignment } from '../../electron/services/settings-cli'

describe('parseSettingAssignment', () => {
  it('parses string libraryRoot', () => {
    expect(parseSettingAssignment('libraryRoot', '/x/y')).toEqual({ ok: true, patch: { libraryRoot: '/x/y' } })
  })
  it('parses csv defaultFormats and rejects junk', () => {
    expect(parseSettingAssignment('defaultFormats', 'md,pdf')).toEqual({ ok: true, patch: { defaultFormats: ['md', 'pdf'] } })
    expect(parseSettingAssignment('defaultFormats', 'nope')).toMatchObject({ ok: false })
  })
  it('parses int historyRetentionDays within range', () => {
    expect(parseSettingAssignment('historyRetentionDays', '30')).toEqual({ ok: true, patch: { historyRetentionDays: 30 } })
    expect(parseSettingAssignment('historyRetentionDays', '0')).toMatchObject({ ok: false })
  })
  it('parses boolean subscriptionAutoCheck', () => {
    expect(parseSettingAssignment('subscriptionAutoCheck', 'true')).toEqual({ ok: true, patch: { subscriptionAutoCheck: true } })
    expect(parseSettingAssignment('subscriptionAutoCheck', 'maybe')).toMatchObject({ ok: false })
  })
  it('validates HH:MM time', () => {
    expect(parseSettingAssignment('subscriptionCheckTime', '07:30')).toEqual({ ok: true, patch: { subscriptionCheckTime: '07:30' } })
    expect(parseSettingAssignment('subscriptionCheckTime', '25:00')).toMatchObject({ ok: false })
  })
  it('validates enums', () => {
    expect(parseSettingAssignment('subscriptionNewArticleAction', 'download')).toMatchObject({ ok: true })
    expect(parseSettingAssignment('subscriptionScheduleMode', 'weekly')).toMatchObject({ ok: false })
  })
  it('rejects non-settable keys', () => {
    expect(parseSettingAssignment('listColumnWidths', '{}')).toMatchObject({ ok: false })
    expect(parseSettingAssignment('cliLinkPrompted', 'true')).toMatchObject({ ok: false })
    expect(parseSettingAssignment('bogus', 'x')).toMatchObject({ ok: false })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/electron/settings-cli.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: 写实现**

```ts
// electron/services/settings-cli.ts
// CLI 设置赋值:把字符串值校验并解析成 AppSettings 的部分补丁。纯函数,无 electron。
import { ALL_FORMATS, type DownloadFormat } from '../../src/core/types'
import type { AppSettings } from './settings'

export const SETTABLE_KEYS = [
  'libraryRoot', 'defaultFormats', 'historyRetentionDays',
  'subscriptionAutoCheck', 'subscriptionCheckTime', 'subscriptionNewArticleAction',
  'subscriptionScheduleMode', 'subscriptionIntervalHours',
] as const

type ParseOk = { ok: true; patch: Partial<AppSettings> }
type ParseErr = { ok: false; error: string }

const fail = (m: string): ParseErr => ({ ok: false, error: m })
const intIn = (raw: string, lo: number, hi: number): number | null => {
  const n = Number(raw)
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null
}

export function parseSettingAssignment(key: string, raw: string): ParseOk | ParseErr {
  switch (key) {
    case 'libraryRoot':
      return raw ? { ok: true, patch: { libraryRoot: raw } } : fail('libraryRoot 不能为空')
    case 'defaultFormats': {
      const set = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
      const out = ALL_FORMATS.filter((f) => set.has(f)) as DownloadFormat[]
      return out.length ? { ok: true, patch: { defaultFormats: out } } : fail(`无有效格式;可选:${ALL_FORMATS.join(',')}`)
    }
    case 'historyRetentionDays': {
      const n = intIn(raw, 1, 3650)
      return n !== null ? { ok: true, patch: { historyRetentionDays: n } } : fail('需 1..3650 的整数')
    }
    case 'subscriptionIntervalHours': {
      const n = intIn(raw, 1, 24)
      return n !== null ? { ok: true, patch: { subscriptionIntervalHours: n } } : fail('需 1..24 的整数')
    }
    case 'subscriptionAutoCheck': {
      if (raw === 'true') return { ok: true, patch: { subscriptionAutoCheck: true } }
      if (raw === 'false') return { ok: true, patch: { subscriptionAutoCheck: false } }
      return fail('需 true 或 false')
    }
    case 'subscriptionCheckTime':
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw)
        ? { ok: true, patch: { subscriptionCheckTime: raw } } : fail('需 HH:MM(24 小时制)')
    case 'subscriptionNewArticleAction':
      return raw === 'notify' || raw === 'download'
        ? { ok: true, patch: { subscriptionNewArticleAction: raw } } : fail("需 'notify' 或 'download'")
    case 'subscriptionScheduleMode':
      return raw === 'daily' || raw === 'interval'
        ? { ok: true, patch: { subscriptionScheduleMode: raw } } : fail("需 'daily' 或 'interval'")
    default:
      return fail(`不可设置的键:${key};可设置:${SETTABLE_KEYS.join(', ')}`)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/electron/settings-cli.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add electron/services/settings-cli.ts tests/electron/settings-cli.test.ts
git commit -m "feat(cli): pure parser/validator for settings assignments"
```

---

### Task 3: `settings get` / `settings set` 命令

**Files:**
- Modify: `src/cli/index.ts`(新增命令组)
- Test: `tests/cli/cli-contract.test.ts`

**Interfaces:**
- Consumes: `settingsFor()`(Task 1)、`parseSettingAssignment`(Task 2)。

- [ ] **Step 1: 写失败测试**

```ts
describe('CLI settings get/set', () => {
  it('get returns full settings; get <key> returns one', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'wxk-set-cli-'))
    await runCli(['settings', 'get'], { userDataDir: ud })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, settings: { subscriptionScheduleMode: 'daily' } })
    stdout = ''
    await runCli(['settings', 'get', 'subscriptionScheduleMode'], { userDataDir: ud })
    expect(JSON.parse(stdout)).toEqual({ ok: true, key: 'subscriptionScheduleMode', value: 'daily' })
  })
  it('set writes a valid key and echoes full settings', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'wxk-set-cli2-'))
    const code = await runCli(['settings', 'set', 'subscriptionIntervalHours', '4'], { userDataDir: ud })
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, settings: { subscriptionIntervalHours: 4 } })
  })
  it('set rejects invalid key/value with exit 2', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'wxk-set-cli3-'))
    const code = await runCli(['settings', 'set', 'subscriptionScheduleMode', 'weekly'], { userDataDir: ud })
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'CLI_ERROR' } })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "settings get/set"`
Expected: FAIL — unknown command `settings`。

- [ ] **Step 3: 写实现**(在 `library` 命令组定义之后、`try { await program.parseAsync(...) }` 之前插入)

```ts
  const settings = program.command('settings').description('读写应用设置')
  settings
    .command('get')
    .description('输出全部设置，或单个键的值')
    .argument('[key]', '设置键名')
    .action(async (key: string | undefined) => {
      const all = await settingsFor().get()
      if (key === undefined) { outJson({ ok: true, settings: all }); return }
      if (!(key in all)) { outJson({ ok: false, error: { code: 'CLI_ERROR', message: `未知设置键:${key}` } }); exitCode = 2; return }
      outJson({ ok: true, key, value: (all as Record<string, unknown>)[key] })
    })
  settings
    .command('set')
    .description('设置一个键的值（仅开放用户可配置键）')
    .argument('<key>', '设置键名')
    .argument('<value>', '值（布尔用 true/false，格式用逗号分隔）')
    .action(async (key: string, value: string) => {
      const parsed = parseSettingAssignment(key, value)
      if (!parsed.ok) { outJson({ ok: false, error: { code: 'CLI_ERROR', message: parsed.error } }); exitCode = 2; return }
      const next = await settingsFor().save(parsed.patch)
      outJson({ ok: true, settings: next })
    })
```

加 import:

```ts
import { parseSettingAssignment } from '../../electron/services/settings-cli'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "settings get/set"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/cli/index.ts tests/cli/cli-contract.test.ts
git commit -m "feat(cli): settings get/set commands"
```

---

### Task 4: `library search` 命令

**Files:**
- Modify: `src/cli/index.ts`(`library` 组加 `search`)
- Test: `tests/cli/cli-contract.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('CLI library search', () => {
  const seed = () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-search-'))
    writeFileSync(join(root, 'library.json'), JSON.stringify({
      version: 1, articles: [
        { id: 'a1', title: '深度学习入门', account: 'AI', publishTime: '', sourceUrl: '', digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: join(root, 'AI', 'a1') },
        { id: 'a2', title: '红楼梦杂谈', account: '文学', publishTime: '', sourceUrl: '', digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir: join(root, '文学', 'a2') },
      ],
    }))
    return root
  }
  it('returns title-matching articles', async () => {
    const code = await runCli(['library', 'search', '学习', '--out', seed()])
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.ok).toBe(true); expect(out.items).toHaveLength(1); expect(out.items[0].id).toBe('a1')
  })
  it('further filters by --account', async () => {
    const root = seed()
    await runCli(['library', 'search', '', '--account', '文学', '--out', root])
    const out = JSON.parse(stdout)
    expect(out.items.map((i: { id: string }) => i.id)).toEqual(['a2'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "library search"`
Expected: FAIL — unknown command。

- [ ] **Step 3: 写实现**(加在 `library.command('list')` 之后)

```ts
  library
    .command('search')
    .description('按标题关键词搜索文库')
    .argument('<keyword>', '标题关键词（空字符串表示不按标题过滤）')
    .option('--account <name>', '再按公众号名过滤')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (keyword: string, opts) => {
      const lib = new Library(await resolveRoot(opts.out))
      const hits = await lib.search(keyword)
      const items = opts.account ? hits.filter((a) => a.account === opts.account) : hits
      outJson({ ok: true, items })
      exitCode = 0
    })
```

> `Library.search('')` 返回全量(见 `library.ts:55`),配 `--account` 可做「只按号过滤」。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "library search"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/cli/index.ts tests/cli/cli-contract.test.ts
git commit -m "feat(cli): library search command"
```

---

### Task 5: `library remove` 命令(含历史联动)

**Files:**
- Modify: `src/cli/index.ts`(`library` 组加 `remove`)
- Test: `tests/cli/cli-contract.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('CLI library remove', () => {
  it('removes by ids and marks history items deleted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-rm-'))
    const dir = join(root, 'AI', 'a1'); mkdirSync(dir, { recursive: true })
    writeFileSync(join(root, 'library.json'), JSON.stringify({
      version: 1, articles: [{ id: 'a1', title: 'T', account: 'AI', publishTime: '', sourceUrl: 'https://x/1', digest: '', coverUrl: '', downloadTime: '', formats: ['md'], dir }],
    }))
    writeFileSync(join(root, 'history.json'), JSON.stringify({
      version: 1, events: [{ id: 'e1', time: Date.now(), source: { kind: 'url', count: 1 }, formats: ['md'], total: 1, succeeded: 1, skipped: 0, failed: 0, items: [{ id: 'a1', url: 'https://x/1', title: 'T', dir, status: 'ok' }] }],
    }))
    const code = await runCli(['library', 'remove', '--ids', 'a1', '--out', root])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, removed: 1 })
    const lib = JSON.parse(readFileSync(join(root, 'library.json'), 'utf-8'))
    expect(lib.articles).toHaveLength(0)
    const hist = JSON.parse(readFileSync(join(root, 'history.json'), 'utf-8'))
    expect(hist.events[0].items[0]).toMatchObject({ deleted: true })
  })
  it('errors with exit 2 when --ids missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-rm2-'))
    const code = await runCli(['library', 'remove', '--out', root])
    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'NO_SELECTOR' } })
  })
})
```

加 import(若文件顶部 `node:fs` 未含 `readFileSync`/`mkdirSync`):测试已 import `mkdirSync`;补 `readFileSync`:

```ts
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "library remove"`
Expected: FAIL — unknown command。

- [ ] **Step 3: 写实现**(加在 `library.command('search')` 之后)

```ts
  library
    .command('remove')
    .description('按 id 删除文库文章（删文件 + 索引 + 历史联动标记已删除）')
    .option('--ids <csv>', '文章 id（逗号分隔）')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (opts) => {
      const ids = opts.ids ? String(opts.ids).split(',').map((s: string) => s.trim()).filter(Boolean) : []
      if (!ids.length) { outJson({ ok: false, error: { code: 'NO_SELECTOR', message: '需指定 --ids' } }); exitCode = 2; return }
      const root = await resolveRoot(opts.out)
      const lib = new Library(root)
      const hist = new History(root)
      let removed = 0
      for (const id of ids) {
        if (await lib.has(id)) { await lib.remove(id); await hist.markDeleted(id); removed++ }
      }
      outJson({ ok: true, removed })
      exitCode = 0
    })
```

加 import:

```ts
import { History } from '../core/download-history'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "library remove"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/cli/index.ts tests/cli/cli-contract.test.ts
git commit -m "feat(cli): library remove command with history delete-linkage"
```

---

### Task 6: 抽出 `runSubscriptionCheck` 服务并改造 ipc

**Files:**
- Create: `electron/services/subscription-check.ts`
- Modify: `electron/ipc.ts`(删内联 `runSubscriptionCheck`,改调服务)
- Test: `tests/electron/subscription-check.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface RunCheckDeps {
    subs: Subscriptions
    settings: Pick<AppSettings, 'defaultFormats' | 'subscriptionNewArticleAction'>
    session: { token: string } | null
    mpFetch: MpFetch | null
    downloadRefs: (refs: ArticleRef[], formats: DownloadFormat[], source: HistorySource) => Promise<void>
    log: (entry: CheckLogEntry) => Promise<void>
    onEmit?: () => void
    check?: typeof checkSubscriptions
  }
  interface RunCheckResult { accounts: number; newFound: number; failed: number; note?: string; authExpired: boolean }
  function runSubscriptionCheck(trigger: 'auto' | 'manual', deps: RunCheckDeps): Promise<RunCheckResult>
  ```

- [ ] **Step 1: 写失败测试**

```ts
// tests/electron/subscription-check.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Subscriptions } from '../../src/core/subscriptions'
import { runSubscriptionCheck } from '../../electron/services/subscription-check'

const newSubs = async (accs: Array<{ fakeid: string; nickname: string; watermark: number }>) => {
  const subs = new Subscriptions(mkdtempSync(join(tmpdir(), 'wxk-subchk-')))
  for (const a of accs) await subs.addAccount({ ...a, subscribed: true })
  return subs
}

describe('runSubscriptionCheck', () => {
  it('no session → note no-session, authExpired true, no download', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 0 }])
    const downloadRefs = vi.fn()
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: null, mpFetch: null, downloadRefs, log: vi.fn(),
    })
    expect(r).toMatchObject({ note: 'no-session', authExpired: true })
    expect(downloadRefs).not.toHaveBeenCalled()
  })

  it('notify mode stores newRefs and advances watermark', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 100 }])
    const check = vi.fn(async () => [{ fakeid: 'f1', ok: true, latest: 200, newRefs: [{ title: 'n', url: 'u', createTime: 200 }] }])
    const downloadRefs = vi.fn()
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'notify' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs, log: vi.fn(), check: check as never,
    })
    expect(r).toMatchObject({ accounts: 1, newFound: 1, failed: 0, authExpired: false })
    expect(downloadRefs).not.toHaveBeenCalled()
    expect((await subs.list())[0]).toMatchObject({ watermark: 200, newRefs: [{ url: 'u' }] })
  })

  it('download mode calls downloadRefs and clears newRefs', async () => {
    const subs = await newSubs([{ fakeid: 'f1', nickname: 'A', watermark: 100 }])
    const check = vi.fn(async () => [{ fakeid: 'f1', ok: true, latest: 200, newRefs: [{ title: 'n', url: 'u', createTime: 200 }] }])
    const downloadRefs = vi.fn(async () => {})
    const r = await runSubscriptionCheck('manual', {
      subs, settings: { defaultFormats: ['md'], subscriptionNewArticleAction: 'download' },
      session: { token: 't' }, mpFetch: (async () => ({})) as never, downloadRefs, log: vi.fn(), check: check as never,
    })
    expect(r).toMatchObject({ newFound: 1 })
    expect(downloadRefs).toHaveBeenCalledOnce()
    expect((await subs.list())[0].newRefs).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/electron/subscription-check.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: 写实现**

```ts
// electron/services/subscription-check.ts
// 订阅检查编排(从 ipc.ts 抽出,GUI 与 CLI 共用)。依赖全注入,无 electron 运行时,可单测。
import { checkSubscriptions } from '../../src/core/check-subscriptions'
import { MpAuthExpired } from '../../src/core/mp-errors'
import type { Subscriptions, CheckLogEntry } from '../../src/core/subscriptions'
import type { ArticleRef, MpFetch } from '../../src/core/mp-types'
import type { DownloadFormat } from '../../src/core/types'
import type { HistorySource } from '../../src/core/download-history'
import type { AppSettings } from './settings'

export interface RunCheckDeps {
  subs: Subscriptions
  settings: Pick<AppSettings, 'defaultFormats' | 'subscriptionNewArticleAction'>
  session: { token: string } | null
  mpFetch: MpFetch | null
  downloadRefs: (refs: ArticleRef[], formats: DownloadFormat[], source: HistorySource) => Promise<void>
  log: (entry: CheckLogEntry) => Promise<void>
  onEmit?: () => void
  check?: typeof checkSubscriptions
}
export interface RunCheckResult { accounts: number; newFound: number; failed: number; note?: string; authExpired: boolean }

export async function runSubscriptionCheck(trigger: 'auto' | 'manual', deps: RunCheckDeps): Promise<RunCheckResult> {
  const { subs, settings, session, mpFetch, downloadRefs } = deps
  const check = deps.check ?? checkSubscriptions
  const emit = () => deps.onEmit?.()
  const now = () => Date.now()

  if (!session || !mpFetch) {
    await deps.log({ time: now(), trigger, accounts: 0, newFound: 0, failed: 0, note: 'no-session' })
    emit(); return { accounts: 0, newFound: 0, failed: 0, note: 'no-session', authExpired: true }
  }
  const accounts = (await subs.list()).filter((a) => a.subscribed)
  if (!accounts.length) {
    await subs.setLastRunAt(now())
    await deps.log({ time: now(), trigger, accounts: 0, newFound: 0, failed: 0, note: 'no-accounts' })
    emit(); return { accounts: 0, newFound: 0, failed: 0, note: 'no-accounts', authExpired: false }
  }
  let results
  try { results = await check(accounts, { mpFetch, token: session.token }) }
  catch (e) {
    if (e instanceof MpAuthExpired) {
      await deps.log({ time: now(), trigger, accounts: accounts.length, newFound: 0, failed: accounts.length, note: 'auth-expired' })
      emit(); return { accounts: accounts.length, newFound: 0, failed: accounts.length, note: 'auth-expired', authExpired: true }
    }
    throw e
  }
  let newFound = 0, failed = 0
  for (const r of results) {
    if (!r.ok) { failed++; continue }
    await subs.updateWatermark(r.fakeid, r.latest)
    if (r.newRefs.length === 0) continue
    newFound += r.newRefs.length
    if (settings.subscriptionNewArticleAction === 'download') {
      const acc = accounts.find((a) => a.fakeid === r.fakeid)!
      await downloadRefs(r.newRefs, settings.defaultFormats, { kind: 'account', nickname: acc.nickname, fakeid: r.fakeid, range: { count: r.newRefs.length } })
      await subs.clearNewRefs(r.fakeid)
    } else {
      await subs.setNewRefs(r.fakeid, r.newRefs)
    }
  }
  await subs.setLastRunAt(now())
  await deps.log({ time: now(), trigger, accounts: accounts.length, newFound, failed })
  emit(); return { accounts: accounts.length, newFound, failed, authExpired: false }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/electron/subscription-check.test.ts`
Expected: PASS(3 用例)。

- [ ] **Step 5: 改造 ipc.ts 调用服务**

`electron/ipc.ts`:删掉第 186–231 行的内联 `const runSubscriptionCheck = async (trigger) => {...}` 整块,替换为薄包装(保留既有 `subsFor`/`emitSubsUpdated`/`subsAuthExpired`/`establishWatermark`/`downloadRefs`/`logCheck` 定义不动):

```ts
  const runSubscriptionCheck = async (trigger: 'auto' | 'manual') => {
    const subs = await subsFor()
    const s = await settings.get()
    const session = getSession()
    const result = await svcRunSubscriptionCheck(trigger, {
      subs, settings: s, session: session ? { token: session.token } : null,
      mpFetch: session ? makeMpFetch(session) : null,
      downloadRefs, log: (entry) => logCheck(subs, entry), onEmit: emitSubsUpdated,
    })
    if (result.note !== 'no-accounts') subsAuthExpired = result.authExpired
  }
```

文件头加 import:

```ts
import { runSubscriptionCheck as svcRunSubscriptionCheck } from './services/subscription-check'
```

> 保留 `if (result.note !== 'no-accounts')` 守卫,精确复刻原行为(原 no-accounts 路径不触碰 `subsAuthExpired`)。`downloadRefs`/`logCheck`/`establishWatermark` 仍是 ipc 内既有闭包,签名与服务期望一致(`logCheck` 需 `subs` 入参,故包成 `(entry) => logCheck(subs, entry)`)。

- [ ] **Step 6: 全量回归(确认 GUI 订阅不回归)**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 全绿(含既有 `tests/core/check-subscriptions.test.ts`、`tests/core/subscriptions.test.ts`)。

- [ ] **Step 7: 提交**

```bash
git add electron/services/subscription-check.ts electron/ipc.ts tests/electron/subscription-check.test.ts
git commit -m "refactor(subs): extract runSubscriptionCheck into shared service for GUI+CLI"
```

---

### Task 7: `subscription list` / `subscription check-now` 命令

**Files:**
- Modify: `src/cli/index.ts`(新增 `subscription` 命令组)
- Test: `tests/cli/cli-contract.test.ts`

**Interfaces:**
- Consumes: `runSubscriptionCheck`(Task 6)、`Subscriptions`/`History`/`mergeAccounts`/`accountsFromHistory`/`nextCheckAt`、`settingsFor`/`resolveRoot`、`getSession`/`makeMpFetch`。

- [ ] **Step 1: 写失败测试**

```ts
describe('CLI subscription list', () => {
  it('lists accounts merged from subscriptions + history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-subs-'))
    writeFileSync(join(root, 'subscriptions.json'), JSON.stringify({
      version: 1, lastRunAt: null, checkLog: [],
      accounts: [{ fakeid: 'f1', nickname: 'A', subscribed: true, watermark: 10, lastCheckedAt: null, newRefs: [] }],
    }))
    const code = await runCli(['subscription', 'list', '--out', root])
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.ok).toBe(true)
    expect(out.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ fakeid: 'f1', subscribed: true })]))
  })
})

describe('CLI subscription check-now', () => {
  it('without session returns ok with note no-session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wxk-cli-chk-'))
    const code = await runCli(['subscription', 'check-now', '--out', root])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, note: 'no-session', newFound: 0 })
  })
})
```

> `getSession` 已被文件顶层 `vi.mock(... mp-auth ...)` 设为返回 `null`,故 check-now 走 no-session 分支,不触网。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "subscription"`
Expected: FAIL — unknown command。

- [ ] **Step 3: 写实现**(加在 `settings` 命令组之前/后均可)

```ts
  const subscription = program.command('subscription').description('公众号订阅')
  subscription
    .command('list')
    .description('列出订阅账号、水位、上次/下次检查')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (opts) => {
      const s = await settingsFor().get()
      const root = await resolveRoot(opts.out)
      const subs = new Subscriptions(root)
      const { events } = await new History(root, s.historyRetentionDays).list(0, 1_000_000)
      const merged = mergeAccounts(accountsFromHistory(events), await subs.list())
      const lastRunAt = await subs.getLastRunAt()
      const next = s.subscriptionAutoCheck
        ? nextCheckAt(Date.now(), lastRunAt, { mode: s.subscriptionScheduleMode, checkTime: s.subscriptionCheckTime, intervalHours: s.subscriptionIntervalHours })
        : null
      outJson({ ok: true, accounts: merged, lastRunAt, nextCheckAt: next, authExpired: false })
      exitCode = 0
    })
  subscription
    .command('check-now')
    .description('立即检查一次订阅更新（频控不重试）')
    .option('-o, --out <dir>', '文章库根目录（默认取设置中的库位置）')
    .action(async (opts) => {
      const s = await settingsFor().get()
      const root = await resolveRoot(opts.out)
      const subs = new Subscriptions(root)
      const session = getSession()
      const downloadRefs = async (refs: import('../core/mp-types').ArticleRef[], formats: DownloadFormat[]) => {
        const library = new Library(root)
        const ddeps = { fetchHtml, fetchBinary, BrowserWindowCtor: BrowserWindow, now: () => new Date().toISOString(), library, libraryRoot: root }
        const queue = new DownloadQueue((url) => downloadArticle(url, formats, ddeps))
        await queue.run(refs.map((r) => r.url))
      }
      const result = await runSubscriptionCheck('manual', {
        subs, settings: s, session: session ? { token: session.token } : null,
        mpFetch: session ? makeMpFetch(session) : null, downloadRefs,
        log: async (e) => { process.stderr.write(formatCheckLogLine(e) + '\n') },
      })
      outJson({ ok: true, accounts: result.accounts, newFound: result.newFound, failed: result.failed, ...(result.note ? { note: result.note } : {}) })
      exitCode = 0
    })
```

加 import:

```ts
import { History } from '../core/download-history'   // 若 Task 5 已加则复用,勿重复
import { Subscriptions, accountsFromHistory, mergeAccounts, formatCheckLogLine } from '../core/subscriptions'
import { nextCheckAt } from '../core/subscription-schedule'
import { runSubscriptionCheck } from '../../electron/services/subscription-check'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "subscription"`
Expected: PASS。

- [ ] **Step 5: 全量校验**

Run: `npm test && npm run lint && npx tsc --noEmit -p tsconfig.json`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add src/cli/index.ts tests/cli/cli-contract.test.ts
git commit -m "feat(cli): subscription list and check-now commands"
```

---

### Task 8: 端到端手验(真实二进制,需登录态)

> 触网/登录步骤只能本地真实环境跑(子 agent 沙箱不行)。无代码改动。

- [ ] **Step 1: 构建**

Run: `npm run build`

- [ ] **Step 2: 验证无鉴权命令(同库)**

```bash
# 先用 GUI 设过 libraryRoot,或:
/path/to/wx-kit settings set libraryRoot ~/Documents/wx-kit
/path/to/wx-kit settings get
/path/to/wx-kit library search 学习            # 不带 --out,应操作设置里的库
/path/to/wx-kit subscription list
```
(打包后 mac CLI 真身见 AGENTS.md:`/Applications/wx-kit.app/Contents/MacOS/wx-kit <子命令>`。)

- [ ] **Step 3: 验证需登录命令**

先 `wx-kit login` 扫码,再 `wx-kit subscription check-now`,核对水位推进与 stderr 日志;与 GUI「立即检查」结果一致。

- [ ] **Step 4: 勾验收**

对照 `docs/PRD-v0.5.0.md` §4 R2 逐条勾。

---

## Self-Review

- **Spec 覆盖**:R2 文库 search(Task 4)/remove(Task 5)、订阅 list(Task 7)/check-now(Task 7)、设置 get/set(Task 3)、默认同库(Task 1)、抽出 runSubscriptionCheck(Task 6)。全覆盖。
- **占位符**:无;每个新命令都有完整 action 代码与对应测试。
- **类型一致**:`runSubscriptionCheck(trigger, deps)`、`RunCheckResult.{accounts,newFound,failed,note?,authExpired}`、`resolveRoot(optOut?)`、`settingsFor()`、`parseSettingAssignment(key,raw)` 在各 Task 与 ipc.ts 引用一致。
- **回归点**:Task 6 改 ipc 后,既有订阅 GUI 行为靠 `result.note !== 'no-accounts'` 守卫 + 全量 `npm test` 守住;Task 1 改 `--out` 缺省,既有显式 `--out` 用例不受影响(resolveRoot 直接返回显式值)。
- **import 去重提醒**:Task 5 与 Task 7 都需 `History`;按 Task 顺序实现时 Task 7 注释已提示「若已加则复用」,避免重复 import 导致 lint 报错。
