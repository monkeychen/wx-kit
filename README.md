# wx-kit · 微信百宝箱

> 把微信公众号文章下载为多种格式并在应用内浏览；支持按公众号批量爬取；
> 同一二进制带 CLI，可被 AI agent 直接调用。单进程 Electron，GUI 与 CLI 双启动模式。

![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![Electron](https://img.shields.io/badge/Electron-42-9feaf9.svg)
![Node](https://img.shields.io/badge/Node-20%2B-339933.svg)
![Status](https://img.shields.io/badge/v0.2.1-released-success.svg)

<!-- 截图：v0.2.0（真实数据态，v0.2.1 功能一致） -->
| 下载 · 按链接 | 下载 · 按公众号 | 文库 · 分组卡片 | 文库 · 列表 | 设置 |
| :---: | :---: | :---: | :---: | :---: |
| ![按链接下载](docs/screenshots/download-url.png) | ![按公众号下载](docs/screenshots/download-account.png) | ![文库·分组卡片](docs/screenshots/library-cards.png) | ![文库·列表](docs/screenshots/library-list.png) | ![设置](docs/screenshots/settings.png) |

## 这是什么

微信百宝箱是一个**桌面工具**:

- **下载**任意微信文章为封面 / Markdown / 网页 / PDF / 元信息 5 种格式;
- **批量爬取**某个公众号的历史文章(按数量或日期范围);
- **库内阅读**已下载文章;
- **同二进制**带 CLI(`npx electron . download ...`),面向 AI agent 自动化调用。

**v0.2.0 已落地**(主题「下得放心、找得到、看得见」,v0.2.1 为同功能安全补丁):

- **下得放心** —— 下载结果就地确认/阅读/复制下载项;失败归一为人话话术+下一步,频控退避有朱砂横幅+倒数;**取消要二次确认**,未下载的文章进历史可单篇补下。
- **找得到** —— 文库可按下载/发布时间排序、按公众号筛选与分组折叠,批量选择+批量删除(只删记录不删文件)。
- **看得见** —— 卡片⇄列表(访达式)两视图随切,分组时列头只一次;PDF 导出不跨页切图。

## 特性

- 🖥 **GUI + CLI 双启动** —— 同一份 Electron 二进制,带子命令即进 CLI,否则开窗口。
- 📦 **多格式导出** —— 封面、Markdown、HTML、PDF、元信息,可任意组合。
- 🔁 **断点续传 + 去重** —— 每篇落盘即写索引,中断/重跑自动跳过。
- 🛡 **节流 + 退避** —— 批量爬取默认串行 + 随机延迟,命中频控自动退避,不裸报错。
- 💻 **单进程单语言** —— 纯 Node + Electron 42,无 Python 边车、无独立 chromium、无数据库(文件系统 + JSON 索引)。
- 🤖 **Agent 友好** —— 同一 CLI 输出纯 JSON,`stdout` 走数据、`stderr` 走进度、退出码 `0/1/2`。

## 30 秒上手(CLI)

```bash
# 1. 装依赖
npm install

# 2. 跑 GUI(开发模式)
npm run dev

# 3. 跑 CLI 试一下
npx electron . download --url "https://mp.weixin.qq.com/s/xxx" --formats md,html,meta
```

输出在 `~/Documents/wx-kit/`(**默认**库根,可在「设置」改)。

## 30 秒上手(下载安装包)

去 [Releases](../../releases) 选平台对应包(最新 v0.2.1:`wx-kit-0.2.1-arm64.dmg`(Apple Silicon) /
`wx-kit-0.2.1.dmg`(Intel) / `wx-kit Setup 0.2.1.exe`(Windows))。当前**未签名/未公证**,首次打开需手动放行:

- **macOS** —— 拖入「应用程序」后,首次打开被拦时进「系统设置 → 隐私与安全性」点「仍要打开」(macOS 15 Sequoia 起已移除「右键→打开」快捷绕过);或命令行 `xattr -cr /Applications/wx-kit.app`。
- **Windows** —— SmartScreen →「更多信息」→「仍要运行」。

## 架构(一分钟)

```
┌─────────────────────────────────────────────┐
│  Electron (单进程)                          │
│  ┌────────────┐  ┌──────────────────────┐    │
│  │  Renderer  │◄─┤  IPC (preload 桥)    │    │
│  │  React UI  │  │  main process        │    │
│  └────────────┘  │  services/*          │    │
│                  │  ipc / wxfile proto  │    │
│                  └─────────┬────────────┘    │
│                            │                 │
│   同一二进制带 CLI ────────┤                 │
│  ┌────────────┐  ┌─────────▼────────────┐    │
│  │  CLI       │──│  src/core/ (纯逻辑)  │    │
│  │  commander │  │  - parse / export    │    │
│  └────────────┘  │  - library / queue   │    │
│                  │  - mp-auth / crawl   │    │
│                  └──────────────────────┘    │
└─────────────────────────────────────────────┘
```

- **`src/core/`** —— UI 无关纯逻辑,被 GUI 与 CLI 共享。**绝不** import electron/renderer。
- **`electron/`** —— 主进程,IPC 处理器做薄委派,`mp-*` 服务对接微信后台。
- **`src/cli/`** —— 同二进制,`src/renderer/` 缺失时即 CLI 模式(详见 [`AGENTS.md`](AGENTS.md))。

完整需求见 [`docs/PRD.md`](docs/PRD.md);当前进度见 [`ROADMAP.md`](ROADMAP.md);开发指南(决策/不变量/陷阱)见 [`AGENTS.md`](AGENTS.md)。

## 命令速查

| 场景 | 命令 |
|---|---|
| 开发(GUI 热更) | `npm run dev` |
| 类型检查 | `npm run typecheck` |
| 单测 | `npm test` |
| 单测(监听) | `npm run test:watch` |
| Lint | `npm run lint` |
| GUI 端到端(Playwright) | `npm run test:e2e` |
| 出 mac 安装包 | `npm run package:mac` |
| 出 win 安装包 | `npm run package:win` |
| 一次性出 mac+win | `npm run package` |
| 进入 CLI 模式 | `npx electron . <子命令>` |

### CLI 子命令

开发期(源码内)用 `npx electron .`:

```bash
npx electron . download --url <u> [--formats md,html,pdf,meta] [--out <dir>]
npx electron . login                                   # 扫码登录公众号后台
npx electron . auth-status                             # 查登录态(真探测)
npx electron . search <公众号名>                        # 搜号,返候选
npx electron . crawl <公众号名> --count 2              # 批量爬取
npx electron . library list                            # 列已下文章
```

退出码:`0` 成功、`1` 业务失败、`2` 用法或鉴权错误。详见 [`docs/PRD.md` §F4](docs/PRD.md)。

### 安装包后的 CLI 用法

GUI 与 CLI 是**同一个二进制**:不带子命令开窗口,带子命令(`download`/`login`/`auth-status`/`search`/`crawl`/`library`)即进 CLI。装完后直接调安装目录里的可执行文件(**不是** `npx electron .`):

**macOS** —— 可执行文件在 .app 包内层:

```bash
/Applications/wx-kit.app/Contents/MacOS/wx-kit download --url "https://mp.weixin.qq.com/s/XXX" --formats md,meta --out ~/Documents/wx-kit

# 嫌路径长,建个软链一劳永逸:
ln -sf /Applications/wx-kit.app/Contents/MacOS/wx-kit /usr/local/bin/wx-kit
wx-kit auth-status
```

> 用内层 `Contents/MacOS/wx-kit`,**别用 `open -a wx-kit`**——`open` 不透传 stdout / 退出码,拿不到 JSON 结果。

**Windows** —— 默认装在 `%LOCALAPPDATA%\Programs\wx-kit\wx-kit.exe`(安装时可改目录):

```powershell
& "$env:LOCALAPPDATA\Programs\wx-kit\wx-kit.exe" download --url "..." --formats md,meta --out . > result.json 2>progress.log
```

> ⚠️ Electron 在 Windows 是 GUI 子系统程序,**stdout 不会回贴到调用它的控制台**——直接在 cmd/PowerShell 里跑看不到那串 JSON。请**重定向到文件**(`> result.json`,GUI 子系统下仍生效);管道 `|` 取 stdout 不可靠。需要稳定 stdout 的 agent 集成优先在 macOS/Linux 上跑。

## 项目状态

**v0.1.0 / v0.2.0 / v0.2.1 均已发布**(最新 v0.2.1 为安全补丁:electron 31→42 + electron-builder 24→26 + vite 6 + vitest 3,Dependabot 28 项归零,功能同 v0.2.0)。各里程碑均合入 main,端到端在真实微信公众号后台验证通过:

**v0.1.0 · 第一阶段主线**
- ✅ M1 — 核心层 + CLI `download` 五格式
- ✅ M2 — GUI:下载页 / 书架 / 阅读器 / 设置
- ✅ M3 — 扫码登录 + 批量爬取(CLI)
- ✅ M3.5 — 批量爬取 GUI 页(单页渐进:登录引导 → 搜号 → 实时逐篇)
- ✅ M4 — electron-builder 打包:未签名 mac(dmg arm64+x64)+ win(nsis x64)

**v0.2.0 · 下得放心、找得到、看得见**
- ✅ M5 — 信息架构重构:导航三项(下载/文库/设置)+「下载」页双模式(URL/公众号)+「书架」→「文库」改名
- ✅ M6 — 下载闭环 + 历史:结果区就地确认/阅读(R1)+ 下载历史 `history.json`(R2)
- ✅ M7 — 反馈引导:频控退避可见 + 失败话术归一(R5);取消需二次确认,未下载文章进历史可单篇补下
- ✅ M8 — PDF 保真:导出 PDF 不跨页切图(R4)
- ✅ M9 — 文库组织:排序 / 按公众号筛选+分组 / 批量删除(R6)+ 卡片⇄列表(访达式)视图切换

**v0.2.1 · 安全补丁(2026-06-09)**
- ✅ 依赖审计:electron 31→42、electron-builder 24→26、vite 6、vitest 3,Dependabot 28 项全部 fixed 归零;功能与 v0.2.0 一致,已出三平台安装包。

详见 [`ROADMAP.md`](ROADMAP.md) 与 [`docs/devlog/wx-kit-vibe-coding.md`](docs/devlog/wx-kit-vibe-coding.md)(逐里程碑的决策/踩坑/方法论)。

## 贡献

欢迎 PR!具体流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md) ——
跑 `npm test` / `npm run typecheck` / `npm run lint` 全部通过再提。
行为准则见 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。

安全漏洞请**不要**公开提 issue,按 [`SECURITY.md`](SECURITY.md) 私下报告。

## 许可证

[Apache License 2.0](LICENSE) — 见文件正文。`Copyright 2026 monkeychen`。

## 致谢

- 设计脱胎于技术探索原型 `../trae/x-downloader`,感谢那段 PyQt 时代留下的判断。
- 用了 [`playwright`](https://playwright.dev) 做 e2e 与图标渲染、[`electron-builder`](https://www.electron.build) 出安装包。
