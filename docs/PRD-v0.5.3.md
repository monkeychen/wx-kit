# wx-kit v0.5.3 产品需求文档（迭代 PRD）

> 本文件是 **v0.5.3 迭代**的需求源头与验收依据。补丁版：修复 macOS 关窗后无法从程序坞重新打开窗口。
> 实现计划见 `docs/plans/2026-07-13-m21-dock-reactivate.md`；状态/进度见 `ROADMAP.md`。

## 1. 一句话定义

补上 macOS 应用生命周期的另一半：关窗后应用驻留程序坞时，**点程序坞图标（`activate` 事件）重建主窗口**——当前缺失该 handler，关窗后应用"假死"，只能强退重开。

## 2. 背景：现状为什么坏（2026-07-13 安哥真机报告）

- dmg 安装后，点窗口左上角红点关闭窗口 → 点程序坞里的应用图标 → 窗口不再出现。
- 根因：`electron/main.ts` 只做了 mac 惯例的一半——`window-all-closed` 在 darwin 上不退出（进程驻留、程序坞图标带小点），但**没有注册 `app.on('activate')`**，关窗后不存在任何重建窗口的代码路径。
- 影响：mac 用户几乎必然用红点关窗（而非 Cmd+Q），关一次窗应用即不可用，体感是「应用坏了」。缺陷自 v0.1.0 M2 起即存在，开发/测试均为整进程启停故一直未暴露。

## 3. 功能需求

### R1 · 程序坞激活重建窗口（里程碑 M21）

- **抽出 `createWindow()`**（`electron/main.ts`）：现有主窗口创建逻辑原样抽函数，GUI 启动时调用一次。
- **注册 `activate` handler**：`app.on('activate')` 时若无任何窗口则 `createWindow()`——点程序坞图标、`open -a` 已运行实例均走此事件（macOS reopen Apple Event）。
- **行为不变项**：`window-all-closed` 的平台分支不变（darwin 驻留、其它平台退出）；CLI 模式不受影响（不走 GUI 分支）。

**存储影响**：无。

### R2 · 发版（v0.5.3）

按发版规约走完整发版；**打包态验证必须包含「关窗 → 真实 reopen 事件 → 窗口重建」**（`open -a` 已运行实例发送与点程序坞图标相同的 reopen Apple Event）。

## 4. 验收标准

### R1 / M21 · activate 重建窗口
- [x] 关闭主窗口后触发 `activate`，应用重建主窗口且界面完整可用（e2e：关窗 → 触发 activate → `app-shell` 重新渲染）。
- [x] 窗口存在时触发 `activate` 不新开重复窗口。
- [x] `npm test`（260）/ `tsc` / `lint` / `npm run test:e2e` 全绿。

### R2 · 发版
- [x] version 0.5.3、`docs/releases/v0.5.3.md`、README/ROADMAP 同步。
- [x] 重新打包；**打包态 .app 真机验证：关窗后 `open -a`（等价程序坞点击的 reopen 事件）窗口重建、界面完整、不重复开窗**，stderr 无异常（2026-07-13）。
- [ ] main 打 annotated tag `v0.5.3` + GitHub Release 三平台包。

## 5. 里程碑拆分

| 里程碑 | 范围 | 状态 |
|--------|------|------|
| **M21** | macOS 程序坞激活重建窗口（R1） | ✅ 已完成（2026-07-13） |

## 6. 非目标

- **窗口状态记忆**（尺寸/位置恢复）——与本缺陷无关，需要时单议。
- **多窗口支持**——单窗口模型不变，activate 只在零窗口时重建。
