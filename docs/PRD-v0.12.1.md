# wx-kit v0.12.1 产品需求文档（迭代 PRD）

> 一项 Windows 体验修复（默认菜单栏隐藏）。2026-09-28 安哥 Windows 实机试用后提出；
> 同日发现实现先行未走流程（PRD 未写即合入 main），本 PRD 与实现计划为流程补齐——
> 技术方案经安哥确认后回填，实现本身已于 commit `2432aa8` 落地并全量验证。
> 当前进度见 `ROADMAP.md`，验收以本文第 4 节为准。

## 1. 一句话定义

**Windows 用户看到的应该是一个干净的内容应用，不是一台带菜单栏的开发者工具。**

## 2. 背景

- 安哥在 Windows 实机上试用 v0.12.0：主窗口顶部挂着 **File / Edit / View / Window /
  Help** 默认菜单栏。wx-kit 是纯内容型 UI（应用内刊头已有品牌区、导航与全部动作），
  这排菜单没有任何一项是用户需要的，且与产品一贯的「刊头即品牌、原生框极简」外观
  决策（M29 标题栏留空同因）相冲突。
- **根因**：项目从未调用 `Menu.setApplicationMenu()`。Electron 在 Windows/Linux
  上会给每个窗口挂默认应用菜单；macOS 的应用菜单位于屏幕顶部系统栏且 wx-kit 未
  自定义过菜单内容（默认菜单在 mac 顶栏里，窗口上不可见），故安哥观察「Mac 没有」。
- **流程教训（devlog §79）**：需求确认后未写 PRD 直接实现合入 main，违反本项目
  「先 PRD → 再计划 → feature 分支实现」的工作流。本版作为流程修复的实证：
  PRD 与实现计划在实现落地后同日补齐，发版仍走完整验收。

## 3. 需求清单

### R1 · Windows/Linux 不显示默认菜单栏

**用户目标**：Windows 安装版启动后，主窗口与扫码登录窗口都不再出现默认菜单栏；
macOS 行为零变化。

**方案**（已落地，`electron/main.ts`，commit `2432aa8`）：

- GUI 分支窗口创建前一行：`if (process.platform !== 'darwin') Menu.setApplicationMenu(null)`。
  应用菜单是**进程级全局**，主窗口与 mp-auth 扫码登录窗口一并生效，无需逐窗设置。
- 放在 GUI 分支而非模块顶层：CLI 模式不创建窗口，不需要也不应该碰菜单状态。
- mac 保留应用菜单不动（系统惯例位置，零感知）。

**副作用核实（实现时逐项验证）**：

- 应用内复制（复制路径/复制命令/导出提示等）全部走主进程 `clipboard:write` IPC
  （`electron/ipc.ts`），不依赖菜单加速器；
- 阅读器/输入框选中文本后 Ctrl+C 为 Chromium 内建行为，不依赖菜单；
- 随默认菜单移除的 Ctrl+R / F12 等加速器，本就是生产环境不该暴露给普通用户的能力，
  移除为净收益；
- 不用 `autoHideMenuBar: true`（Alt 唤出）：那是「有菜单需求」应用的保留式方案，
  本产品菜单无存在价值，删干净比藏起来更符合「不为功能设计」。

## 4. 验收清单（逐条）

- [x] 实现合入 main 时 `npx tsc --noEmit -p tsconfig.json`、`npm run lint`、
  `npm test`（1037 单测）全绿（2026-09-28）。
- [x] GUI e2e 全流程回归通过——应用菜单变更不破坏既有 GUI 链路（2026-09-28，
  macOS 实跑 `npm run test:e2e`，headless 模式 ALL PASSED）。
- [ ] 打包产物真机启动验证：mac .app 正常启动、无菜单相关回归（待 v0.12.1 发版时随
  发版验收执行）。
- [ ] Windows 实机验收（安哥执行）：安装 `wx-kit.Setup.0.12.1.exe`，主窗口无
  File/Edit 菜单栏、阅读器选中文本 Ctrl+C 可复制、设置页「复制」按钮正常。
- [x] 代码注释写明「为什么非 darwin 才置空」与全局生效范围，后人不再困惑 mac 为何
  不处理（`electron/main.ts`）。

## 5. 非目标

- 不做 `autoHideMenuBar`（Alt 唤出）保留式菜单。
- 不自定义任何应用菜单内容（mac 顶栏维持 Electron 默认菜单，无用户反馈问题）。
- 不处理 Windows CLI stdout 正解（候选池原样，见 ROADMAP）。
