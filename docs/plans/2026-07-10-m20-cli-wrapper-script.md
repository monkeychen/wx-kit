# M20 · 命令行入口改 wrapper 脚本 + 旧软链自愈（v0.5.2）

> 需求与验收：`docs/PRD-v0.5.2.md`。分支：`feat/m20-cli-wrapper-script`。
> 改动面：`electron/services/cli-link.ts` + `electron/ipc.ts`（status 自愈）+ `CliLinkPrompt.tsx` 文案 + 测试。

## 根因（2026-07-10 真机实证,详见 PRD §2）

symlink 调用下 macOS Electron 到 `<软链所在目录>/../Frameworks/` 找 Helper app → 不存在 → GPU/网络/渲染子进程全崩。
wrapper 脚本 `exec` 真实路径即修复（已用真实 download+pdf 验证）。

## 实现步骤

### 1. TDD：改写 `tests/electron/cli-link.test.ts`
- `wrapperScript(target)` 内容形态（shebang + exec + `"$@"`）。
- `linkStatus` 状态矩阵：缺失→`unlinked`;wrapper 内容匹配→`linked`;**指向 target 的 symlink→`legacy`**;指向别处的 symlink→`conflict`;内容不符的普通文件→`conflict`。
- `createLink`:产出 0755 可执行 wrapper→`linked`;非 force 遇占位抛错;force 覆盖旧 symlink/旧文件。

### 2. 实现 `electron/services/cli-link.ts`
- 新增 `wrapperScript(target)`:`#!/bin/sh\nexec "${target}" "$@"\n`。
- `createLink`:`writeFile(linkPath, wrapperScript(target), { mode: 0o755, flag: force ? 'w' : 'wx' })`,force 先 `unlink`（覆盖 symlink 需先删,否则写穿到目标）。
- `linkStatus`:先 `lstat`/`readlink` 分辨 symlink（→`legacy`/`conflict`）,非 symlink 读内容比对 wrapper（→`linked`/`conflict`）,ENOENT→`unlinked`。
- `LinkStatus` 类型加 `'legacy'`。

### 3. ipc 自愈（`electron/ipc.ts` cliLink:status）
`legacy` → `createLink(..., force=true)` 重建 → 返回重建后状态。注释写明这是 v0.5.1 及以前软链形态的自动升级。

### 4. 文案（`CliLinkPrompt.tsx`）
「创建指向应用的软链」→「创建指向应用的快捷命令」。

### 5. 验证
- `npm test` / `lint` / `tsc` / `npm run test:e2e`。
- 真机模拟自愈:在 `~/bin` 人工放回旧 symlink → 开 GUI（隔离 userData）→ 断言被替换为 wrapper 且 status=linked。
- 打包态:`npm run build` 后经 wrapper 跑 `--version` + `download --formats md,pdf`（补 M18 漏掉的验证项）。

### 6. 收尾
ROADMAP M20 行 + devlog §30;合 main;发版 R2（push/release 等发话）。
