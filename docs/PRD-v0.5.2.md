# wx-kit v0.5.2 产品需求文档（迭代 PRD）

> 本文件是 **v0.5.2 迭代**的需求源头与验收依据。补丁版：修复 M18 命令行入口在 macOS 上的致命缺陷。
> 实现计划见 `docs/plans/2026-07-10-m20-cli-wrapper-script.md`；状态/进度见 `ROADMAP.md`。

## 1. 一句话定义

把 M18 创建的命令行入口从 **symlink 改为 wrapper 脚本**：软链形态下 macOS Electron 按调用路径定位 bundle 内 Helper app 必然失败，导致 `wx-kit download` 等一切需要子进程（GPU/网络/渲染）的命令崩溃——wrapper 脚本 `exec` 真实路径后 Helper 定位正常；旧软链自动静默升级。

## 2. 背景：现状为什么坏（2026-07-10 真机实证）

- 安哥真机执行 `wx-kit download` 报 `FATAL: Unable to find helper app`（`electron_main_delegate_mac.mm:66`）+ GPU/网络服务连环崩。
- 根因：`~/bin/wx-kit` 是指向 `/Applications/wx-kit.app/Contents/MacOS/wx-kit` 的 **symlink**。macOS 上 Electron 以「自己被调用的路径」定位同 bundle 的 `Frameworks/wx-kit Helper*.app`——经软链调用时到 `~/bin/../Frameworks/` 找,不存在 → 子进程全起不来。
- **为何 M18 验证没暴露**：`--version`/`--help`/`library list` 等纯主进程命令不需要 Helper,侥幸可用;当时验证恰好只跑了这类命令。`download`（尤其含 pdf）需要网络/渲染子进程,必崩。
- 已验证修复形态：wrapper 脚本（`#!/bin/sh` + `exec "<真实路径>" "$@"`）下同一条 `download --formats md,pdf` 完全正常（VS Code 的 `code` 命令即此做法）。

## 3. 功能需求

### R1 · 命令行入口改 wrapper 脚本 + 旧软链自愈（里程碑 M20）

- **`createLink` 改写 wrapper 脚本**（`electron/services/cli-link.ts`）：内容为 `#!/bin/sh\nexec "<target>" "$@"\n`,权限 0755;非 force 时已存在则报错（保持原语义）,force 先删再建。macOS/Linux 统一（Linux 无此 bug 但统一形态无害）。
- **`linkStatus` 四态**：`unlinked`（不存在）/ `linked`（内容等于目标 wrapper 的普通文件）/ **`legacy`（指向 target 的旧版 symlink——功能是坏的,须升级）** / `conflict`（其它占位:指向别处的 symlink、内容不符的文件）。
- **旧软链静默自愈**：ipc `cliLink:status` 检测到 `legacy` → 自动 `createLink(force)` 重建为 wrapper 并返回升级后状态。GUI 每次启动都会查一次 status（`CliLinkPrompt`）,老用户开一次 GUI 即修复,零打扰、无新弹窗;renderer 永远看不到 `legacy`。
- **文案**：首启 Modal 中「软链」表述改为「快捷命令」（与实际形态一致）。

**存储影响**：无。`AppSettings` 不变,`cliLinkPrompted` 语义不变。

### R2 · 发版（v0.5.2）

按发版规约走完整发版;**打包态验证必须包含「经命令行入口跑 download（含 pdf）」**——补上 M18 漏掉的这条。

## 4. 验收标准

### R1 / M20 · wrapper 脚本 + 自愈
- [x] `createLink` 产出可执行 wrapper 脚本,内容含 `exec "<target>" "$@"`;非 force 遇占位报错、force 覆盖。
- [x] `linkStatus`:wrapper 匹配 → `linked`;指向 target 的 symlink → `legacy`;指向别处的 symlink / 内容不符文件 → `conflict`;缺失 → `unlinked`。
- [x] ipc `cliLink:status` 遇 `legacy` 自动重建为 wrapper 后返回 `linked`（真机验证 2026-07-10:放回旧 symlink → 开 GUI → 自动替换为 wrapper,内容/可执行位断言通过）。
- [x] 纯逻辑 TDD 覆盖上述状态矩阵;`npm test`（260）/ `tsc` / `lint` / `npm run test:e2e` 全绿。
- [x] 真机:经 wrapper 命令行入口跑 `download --formats md,pdf` 成功、无 Helper/GPU 报错。

### R2 · 发版
- [x] version 0.5.2、`docs/releases/v0.5.2.md`、README/ROADMAP 同步（含改掉 README 教用户 `ln -sf` 的同坑段落）。
- [x] 重新打包;**打包态经命令行入口（wrapper）跑 `--version` + `download`（含 pdf）**全部正常,stderr 零 Helper/GPU 报错（2026-07-10）。
- [ ] main 打 annotated tag `v0.5.2` + GitHub Release 三平台包（push 与 release 等安哥发话）。

## 5. 里程碑拆分

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M20** | 命令行入口 wrapper 脚本 + 旧软链自愈（R1） | ✅ 已完成（2026-07-10） |

## 6. 非目标

- **Windows 命令行入口**——延续既往非目标（GUI 子系统 stdout 问题未解,ROADMAP 候选）。
- **主动扫描用户自建软链**——只自愈我们建的 `~/bin/wx-kit`;用户在其它位置手建的软链不属产品管辖（安哥机器上的 `~/.local/bin/wx-kit` 已手工修复）。
