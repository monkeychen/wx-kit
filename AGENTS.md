# wx-kit — Agent 指南

> 本文件是 wx-kit 项目对所有 AI 编码 agent 的权威指南（CLAUDE.md 软链到此）。
> 它是稳定的「宪法」——只放决策、不变量、陷阱，**不放易变的进度状态**。
> 新开会话续接项目时，先读这里；**当前进度/路线图看 `ROADMAP.md`**，实现细节看 `docs/`。

## 是什么
微信百宝箱桌面应用。第一阶段只做"文章下载器"：把微信公众号文章下载为多种格式并在应用内浏览，同时提供 CLI 供 AI agent 调用。单进程 Electron，双启动模式：GUI 与 CLI。

后续是可扩展的"百宝箱"，但**当前不预造空模块**（YAGNI）。

本项目脱胎于技术探索原型 `../trae/x-downloader`（PyQt→Electron 迁移的遗留物），产品化时做了几个**已定的不可回退决策**。

---

## 已定关键决策（勿回退，2026-06 安哥确认）
- **弃用代理模式**：原型用 AnyProxy 做全局 HTTPS MITM 拦截 PC 微信流量，装根证书、改系统代理，脆弱且有还原风险。**不要重新引入代理抓取。**
- **纯 Node/Electron，无 Python 边车**：原型的 FastAPI + Playwright + PyInstaller 是 PyQt 时代遗留。**不要重新引入 Python / 独立 chromium / 数据库**——单一语言、单进程、单二进制。
- **双启动模式服务于 AI agent**：CLI 输出纯 JSON 就是为了让 agent 通过 skill 调用，这是产品定位的一部分。
- **第一阶段不做授权/激活系统**：开箱即用，不加付费门槛。后续要商业化再单独议（`electron/main.ts` 当前无 license 校验）。

---

## 工作流约定（每个里程碑）
1. 先 `docs/plans/YYYY-MM-DD-<里程碑>.md` 写实现计划（参照 M1/M2 的规格：bite-sized 步骤、TDD、确切代码）。
2. 就地开 feature 分支实现（`feat/<里程碑>`），完成后合回 main、删分支。
3. 纯逻辑 TDD；依赖网络/Electron 的部分注入依赖 + 端到端验证。
4. 改完跑 `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`。
5. **完成一个相对独立的功能即自动收尾，无需询问**：验证通过后，若开了 feature 分支，默认合回 main 并删分支；commit 一律自动执行（message 用英文、描述变更意图）。此为本项目长期授权，覆盖「commit 前先问」的默认。**唯 `git push` 仍手动，等安哥发话**（跨设备同步用）。
6. **每完成一个里程碑，更新 `docs/devlog/wx-kit-vibe-coding.md`**：把该里程碑的流程/决策/踩坑/方法论增补进复盘，保持其为活文档。

## 结构约定
- `src/core/`：UI 无关核心层，被 GUI（IPC）与 CLI 共享。**不得 import React/renderer/electron 运行时**（types 可以；electron 仅以注入的 BrowserWindow 构造器形式出现）。
- `electron/`：主进程。`main.ts` 模式分流；`ipc.ts` IPC 处理器（薄委派）；`preload.ts` contextBridge；`protocol.ts` wxfile 协议；`services/` 主进程服务。
- `src/cli/`：命令行入口，输出契约见 PRD §F4（stdout 纯 JSON，stderr 进度，退出码 0/1/2）。
- `src/renderer/`：React 界面，只经 `window.api`（见 `src/renderer/api.ts`）调用能力，**绝不直接 import core**。
- `tests/`：`tests/core`、`tests/electron` 镜像源码的 vitest 单测；`tests/fixtures` 放样本；`tests/e2e/gui.e2e.mjs` 是 Playwright Electron 端到端。

## 沟通语言（强约束）
- **与用户的所有交流一律用中文**——回答、解释、提问、进度报告、方案对比，全程中文。
- 代码、标识符、注释、commit message、PR 描述用英文。

## 命名/格式
- 文件 kebab-case，类型 PascalCase，函数/变量 camelCase。
- 密钥/token 不进代码。不为跑通而注释报错，找根因。

---

## 常用命令
```bash
npm install            # 安装依赖（Node 20+）
npm run dev            # 启动 GUI 开发模式（vite + electron）
npm test               # 跑 vitest 单测（纯逻辑，CI 友好）
npm run test:e2e       # 构建 + Playwright 驱动真实 Electron 跑 GUI 全流程
npm run lint           # eslint
npx tsc --noEmit -p tsconfig.json   # 类型检查
npm run build          # tsc -b + vite build + electron-builder（出安装包，M4）

# CLI（与 GUI 同一二进制，带子命令即进 CLI 模式）：
npx electron . download --url "https://mp.weixin.qq.com/s/XXX" --formats md,html,pdf,meta --out <dir>
```

---

## 关键约束与已知陷阱（容易重踩，务必注意）
- **微信频控**：批量抓取默认串行 + 随机延迟（PRD §9）。已删除文章会返回 HTTP 200 错误页 → 用"解析后标题为空即视为无效文章"判定失败（见 `src/core/download-article.ts`）。
- **文章库**：默认在用户文档目录下（`~/Documents/wx-kit`），可在设置改。文件系统存储 + `library.json` 索引，不用数据库。
- **构建：undici 必须 external**（`vite.config.ts`）。cheerio 依赖 undici，其 sqlite-cache-store 静态 `require('node:sqlite')`，Electron 31 的 Node 没有该内置模块，打进 bundle 会导致主进程加载即崩溃。我们只用 `cheerio.load`，故 external 让它惰性、永不加载。
- **CLI 模式必须注册 no-op `window-all-closed`**（`electron/main.ts`）：否则 PDF 用的离屏 BrowserWindow 关闭会触发 Electron 默认自动退出，截断流程。
- **`wxfile://` 协议**：阅读器读本地图片用，路径严格限制在库根内（`electron/protocol.ts` 的 `resolveWxfilePath`，含编码 `..` 穿越防护）。
- **HTML 阅读器 iframe** 用 `sandbox`（无 `allow-scripts`）：安全，但意味着 Playwright 无法在其内部执行脚本——e2e 里 HTML 视图只断言 iframe src，图片渲染由 md 视图的 `naturalWidth>0` 等价证明。
- **e2e 只能在主会话/本地跑**：子 agent 的沙箱解析不了 electron 二进制。Antd v6 会在两个汉字按钮文本间自动插空格（"阅 读"），写选择器时注意。

---

## 文档索引
- `ROADMAP.md` — **里程碑状态与路线图（续接看这里）**。状态/进度只在这里维护；各里程碑的详细实现计划放在 `docs/plans/`，其逐里程碑索引也在 ROADMAP 维护。
- `docs/PRD.md` — 第一阶段（v0.1.0）产品需求（全貌、F1–F5、架构、风控、验收）。
- `docs/PRD-v0.2.0.md` — **v0.2.0 迭代需求**（信息架构重构、下载闭环/历史、流程可回退、保真与反馈、文库组织；里程碑 M5–M9）。
- `docs/devlog/wx-kit-vibe-coding.md` — vibe-coding 全程复盘（活文档，每完成一个里程碑增补；流程/决策/踩坑/方法论）。

> 进度的唯一真相是 `git log` + `ROADMAP.md` + `docs/plans/`，不是散落在指南里的散文。
