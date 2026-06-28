# M16 — 模式分流修复 + help/version 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `wx-kit -h/--help/-v/--version` 与 `wx-kit help [cmd]` 都正确进入 CLI 并输出到 stdout,不再误进 GUI;无参 `wx-kit` 仍开 GUI。

**Architecture:** 把「argv 是否属 CLI 调用」的判定从 `electron/main.ts` 抽到纯函数模块 `electron/cli-dispatch.ts`(可单测),并让它识别 help/version flag 与 `help` 子命令。`runCli` 接受可选 `version`,用 commander `.version()` 接 `-v/--version` 输出裸版本号;把 commander 的 `writeOut` 改打 stdout(help/version 是主动查询),`writeErr` 留 stderr(报错 usage)。

**Tech Stack:** TypeScript、commander、vitest、Electron(main 进程)。

## Global Constraints

- CLI stdout 契约:命令结果是纯 JSON;**例外**:`--version` 输出裸 semver、`--help`/`help` 输出帮助文本(均到 stdout)。报错触发的 usage 走 stderr。退出码:help/version = 0;参数错误 = 2(沿用 `runCli` 现有 `CLI_ERROR` 分支)。
- `src/core/` 不得 import electron 运行时;本计划新增的 `electron/cli-dispatch.ts` 属主进程侧,允许被 `main.ts` import,本身不 import electron(纯函数)。
- 与用户交流用中文;代码/标识符/commit message 用英文。
- 改完跑 `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`。
- 需求与验收依据:`docs/PRD-v0.5.0.md` §3 R1 / §4 R1。设计:`docs/superpowers/specs/2026-06-28-v0.5.0-cli-experience-design.md` M16。

## File Structure

- Create: `electron/cli-dispatch.ts` — 纯函数 `isCliInvocation(argv)` + 导出的命令名集合。
- Create: `tests/electron/cli-dispatch.test.ts` — `isCliInvocation` 单测。
- Modify: `electron/main.ts` — 删内联 `CLI_COMMANDS`/`isCliInvocation`,改 import;`runCli(args, { version: app.getVersion() })`。
- Modify: `src/cli/index.ts` — `runCli` 签名加可选 `opts.version`;接 `.version()`;`configureOutput` 拆 writeOut→stdout。
- Modify: `tests/cli/cli-contract.test.ts` — 增 help/version 用例。

---

### Task 1: 纯函数分流判定 `cli-dispatch`

**Files:**
- Create: `electron/cli-dispatch.ts`
- Test: `tests/electron/cli-dispatch.test.ts`

**Interfaces:**
- Produces: `isCliInvocation(argv: string[]): boolean`;`CLI_COMMANDS: Set<string>`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/electron/cli-dispatch.test.ts
import { describe, it, expect } from 'vitest'
import { isCliInvocation } from '../../electron/cli-dispatch'

describe('isCliInvocation', () => {
  it('subcommands are CLI', () => {
    for (const c of ['download', 'crawl', 'search', 'login', 'auth-status', 'library', 'subscription', 'settings', 'help'])
      expect(isCliInvocation([c])).toBe(true)
  })
  it('help/version flags are CLI even as first arg', () => {
    for (const f of ['-h', '--help', '-v', '--version']) expect(isCliInvocation([f])).toBe(true)
  })
  it('flags anywhere in argv are CLI', () => {
    expect(isCliInvocation(['download', '--help'])).toBe(true)
  })
  it('no args is GUI', () => { expect(isCliInvocation([])).toBe(false) })
  it('unknown leading token without flags is GUI', () => { expect(isCliInvocation(['frobnicate'])).toBe(false) })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/electron/cli-dispatch.test.ts`
Expected: FAIL — Cannot find module '../../electron/cli-dispatch'

- [ ] **Step 3: 写实现**

```ts
// electron/cli-dispatch.ts
// 纯函数:决定一组用户参数应进 CLI 还是 GUI。无 electron 依赖,可单测。
export const CLI_COMMANDS = new Set([
  'download', 'crawl', 'search', 'login', 'auth-status',
  'library', 'subscription', 'settings', 'help',
])
const CLI_FLAGS = new Set(['-h', '--help', '-v', '--version'])

/** argv[0] 是已知子命令,或 argv 任意位置含 help/version flag → CLI;空参 → GUI。 */
export function isCliInvocation(argv: string[]): boolean {
  if (argv.length === 0) return false
  if (CLI_COMMANDS.has(argv[0])) return true
  return argv.some((a) => CLI_FLAGS.has(a))
}
```

> 注:`subscription`/`settings` 此刻在 M17 才落子命令;先纳入集合无害(M16 合入后 `wx-kit subscription` 会进 CLI 模式,commander 报「unknown command」到 stderr 退 2,而非误开 GUI)。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/electron/cli-dispatch.test.ts`
Expected: PASS(5 个用例)

- [ ] **Step 5: 提交**

```bash
git add electron/cli-dispatch.ts tests/electron/cli-dispatch.test.ts
git commit -m "feat(cli): pure isCliInvocation that recognizes help/version flags"
```

---

### Task 2: runCli 接 version + help/version 走 stdout;main.ts 改用 cli-dispatch

**Files:**
- Modify: `src/cli/index.ts:39-45`(`runCli` 签名 + `configureOutput`)、`src/cli/index.ts:49`(接 `.version()`)
- Modify: `electron/main.ts:13-23`(删内联、import cli-dispatch)、`electron/main.ts:35`(传 version)
- Test: `tests/cli/cli-contract.test.ts`(增用例)

**Interfaces:**
- Consumes: `isCliInvocation`、`CLI_COMMANDS`(来自 Task 1)。
- Produces: `runCli(argv: string[], opts?: { version?: string }): Promise<number>`(`version` 默认 `'0.0.0-dev'`)。

- [ ] **Step 1: 写失败测试**(加到 `tests/cli/cli-contract.test.ts` 末尾)

```ts
describe('CLI help & version', () => {
  it('--version prints bare version to stdout, exit 0', async () => {
    const code = await runCli(['--version'], { version: '9.9.9' })
    expect(code).toBe(0)
    expect(stdout).toBe('9.9.9\n')
  })
  it('-v is an alias for --version', async () => {
    const code = await runCli(['-v'], { version: '9.9.9' })
    expect(code).toBe(0)
    expect(stdout).toBe('9.9.9\n')
  })
  it('--help prints usage to stdout, exit 0, no JSON error', async () => {
    const code = await runCli(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('Usage')
    expect(stdout).not.toContain('"ok"')
  })
})
```

> `stdout` 已在文件顶层 `beforeEach` 里捕获 `process.stdout.write`;`process.stderr.write` 被静默 mock。version 经 commander `writeOut` 输出,改打 stdout 后会落进 `stdout`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/cli/cli-contract.test.ts -t "help & version"`
Expected: FAIL — `--version` 现在不被识别(commander 无 version 选项)/或 stdout 为空(writeOut 仍打 stderr)。

- [ ] **Step 3: 改 runCli**

`src/cli/index.ts` 签名与输出配置(替换 39–45 行):

```ts
/** 解析 CLI 参数并执行；返回退出码 */
export async function runCli(argv: string[], opts: { version?: string } = {}): Promise<number> {
  const program = new Command()
  program.name('wx-kit').description('微信百宝箱 CLI').exitOverride()
  program.version(opts.version ?? '0.0.0-dev', '-v, --version', '输出版本号')
  program.configureOutput({
    writeOut: (s) => process.stdout.write(s),   // help/version 是主动查询,走 stdout
    writeErr: (s) => process.stderr.write(s),   // 报错 usage 走 stderr
  })
```

> 其余 `runCli` 主体不变。文件尾部 `catch` 已放行 `commander.helpDisplayed`/`commander.help`/`commander.version`(退 0),无需改。

- [ ] **Step 4: 改 main.ts 用 cli-dispatch 并传 version**

`electron/main.ts`:删除第 13–17 行的内联 `CLI_COMMANDS`/`isCliInvocation`;在文件头部 import 区(第 4 行 `import { runCli }` 下)加:

```ts
import { isCliInvocation } from './cli-dispatch'
```

把第 35 行 `const code = await runCli(args)` 改为:

```ts
    const code = await runCli(args, { version: app.getVersion() })
```

(`app` 已在第 2 行 import;`app.getVersion()` 读 package.json version,打包/开发均可用。)

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/cli/cli-contract.test.ts`
Expected: PASS(原有用例 + 3 个新用例全绿)

- [ ] **Step 6: 全量校验**

Run: `npm test && npm run lint && npx tsc --noEmit -p tsconfig.json`
Expected: 全绿。

- [ ] **Step 7: 提交**

```bash
git add src/cli/index.ts electron/main.ts tests/cli/cli-contract.test.ts
git commit -m "feat(cli): wire -v/--version (bare semver) and route help/version to stdout"
```

---

### Task 3: 端到端手验(真实二进制)

> 单测覆盖逻辑;此步在主会话/本地用真实 electron 验证分流(子 agent 沙箱跑不了 electron,见 AGENTS.md)。无代码改动,验证用。

- [ ] **Step 1: 构建并验证 help/version/分流**

Run(mac/Linux,清代理见记忆 wx-kit-download-needs-proxy-unset 不必,这里不下载):

```bash
npm run build
npx electron . --version        # 期望:打印版本号(同 package.json),退出 0,不开窗
npx electron . --help           # 期望:打印含 Usage 的帮助,退出 0,不开窗
npx electron . help crawl       # 期望:打印 crawl 子命令用法
npx electron . download --help  # 期望:打印 download 用法
```

- [ ] **Step 2: 确认无参仍开 GUI**

Run: `npx electron .`
Expected: 打开 GUI 窗口(不进 CLI)。手动关窗。

- [ ] **Step 3: 勾验收**

对照 `docs/PRD-v0.5.0.md` §4 R1 六条逐条勾。

---

## Self-Review

- **Spec 覆盖**:R1 的「flag+子命令都提供」(Task 2 `.version`,commander 自带 `-h`/`help`)、「version 裸 semver」(Task 2 测 `'9.9.9\n'`)、「help/version 走 stdout」(Task 2 `writeOut`)、「无参仍 GUI」(Task 1 测 `[]`→false + Task 3 手验)、「报错 usage 走 stderr」(`writeErr` 保留)。全覆盖。
- **占位符**:无。
- **类型一致**:`runCli(argv, opts?)`、`isCliInvocation(argv)`、`CLI_COMMANDS` 在 Task 1/2/main.ts 引用一致。
