# M79 · Windows 默认菜单栏隐藏（v0.12.1）

> 背景(2026-09-28 安哥 Windows 实机试用 v0.12.0 后提出):主窗口顶着 File/Edit/View/
> Window/Help 默认菜单栏,Mac 上却没有。**流程警示:本里程碑实现先行(未写 PRD 即
> 合入 main,commit `2432aa8`),PRD 与本计划为同日补齐**——反例已记入 devlog §79,
> 下不为例。

## 已定决策(勿再议)

- **`Menu.setApplicationMenu(null)` 且仅非 darwin**:应用菜单是进程级全局,主窗口与
  mp-auth 扫码窗一并生效;macOS 菜单在屏幕顶栏、窗口上不可见,维持默认即零变化。
- **放 GUI 分支、不放模块顶层**:CLI 模式不开窗,不碰菜单状态。
- **不用 `autoHideMenuBar`**:Alt 唤出是「有菜单」应用的方案;本产品菜单无存在价值,
  删干净(不为功能设计)。
- **加速器损失已核实为净收益**:应用内复制全走主进程 `clipboard:write` IPC;
  选中文本 Ctrl+C 是 Chromium 内建;随菜单移除的 Ctrl+R/F12 是生产不该暴露的能力。

## Task 1 · main.ts 一行修复(已完成,commit 2432aa8)

`electron/main.ts` GUI 分支(`app.dock.show()` 之后、`createWindow` 之前):

```ts
// 只在 mac 保留应用菜单(File/Edit 等挂在屏幕顶部系统栏);Windows/Linux 若不显式置空,
// Electron 会给每个窗口挂默认菜单栏(File/Edit/View/Window/Help),与纯内容型 UI 相冲突。
if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
```

import 行补 `Menu`。

## Task 2 · 回归验证(已完成)

- `npx tsc --noEmit -p tsconfig.json` / `npm run lint` / `npm test`(1037)全绿。
- `npm run test:e2e` GUI 全流程全绿(应用菜单为全局状态,e2e 跑通即证明未破坏渲染层)。

## Task 3 · 发版(待安哥发版指令后执行,2026-09-28 安哥明确:先归档 PRD,不发版)

- 版本 bump 0.12.1、ROADMAP 当前状态与发布史、README 版本相关处、`docs/releases/v0.12.1.md`。
- `npm run build` 出 mac dmg + win 包;真启 .app 验证。
- 打 tag → GitHub Release(逐个上传三平台包)→ brew tap 刷新 + 零下载核实。
- Windows 实机验收(PRD §4 最后一条未勾项)由安哥执行。
- 发版完成定义见 AGENTS.md:GitHub Release + brew tap 双渠道上线并逐一核实。
