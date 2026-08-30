# wx-kit · 微信百宝箱

> 下载微信公众号文章，保存为可阅读、可检索、可继续创作的本地资料；同一应用同时提供 GUI 与纯 JSON CLI。

![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![Electron](https://img.shields.io/badge/Electron-42-9feaf9.svg)
![Node](https://img.shields.io/badge/Node-20%2B-339933.svg)
![Status](https://img.shields.io/badge/v0.10.1-released-success.svg)

## 这是什么

wx-kit 是一个本地优先的微信公众号文章下载器：

- 粘贴一个或多个文章链接，下载为 Markdown、HTML、PDF、封面和元信息；
- 自动保存正文图片，默认同时下载文章内视频；
- 在本地文库中阅读、搜索、分组、删除和导出素材；
- 可把文库文章同步为 Astro 站点内容；
- GUI 适合日常使用，CLI 输出纯 JSON，适合 AI agent 和脚本调用。

> **当前能力边界（v0.10.1）**
>
> v0.10.1 在 v0.10.0 的**微信读书（WeRead）后端**订阅能力上，补充了可靠的本地发表日期日报和独立 CLI 进程 Cookie 会话续用：
>
> - 识别公众号改用「粘贴该号**任意一篇文章链接**」——微信读书无按名字搜索接口；
> - **降级项**：微信读书列表接口被服务端按账号限制，每次仅返回该号**最新一篇**文章；「按公众号批量下载」入口已移除（CLI `crawl` 稳定拒绝），自动订阅与日报无法找回两次刷新间被覆盖的文章；
> - 按文章 URL 下载不依赖登录态，仍是主功能，未受影响。

## 当前界面

以下截图来自 v0.9.0 正式界面，并由同一篇真实公众号文章完成下载、入库和阅读后生成。

| URL 下载与历史 | 本地文库 |
|---|---|
| ![URL 下载完成并写入下载历史](docs/screenshots/download.png) | ![真实文章进入本地文库](docs/screenshots/library.png) |

| Markdown 阅读器 | 有效设置 |
|---|---|
| ![在应用内阅读本地 Markdown 正文](docs/screenshots/reader.png) | ![只保留当前有效配置的设置页](docs/screenshots/settings.png) |

## 快速开始

### 开发运行

```bash
npm install
npm run dev

# CLI 下载一篇或多篇文章
npx electron . download \
  --url "https://mp.weixin.qq.com/s/XXX" \
  --formats md,html,meta
```

默认文库位于 `~/Documents/wx-kit/`，可在设置页修改。

### macOS：Homebrew

```bash
brew install --cask monkeychen/wx-kit/wx-kit
xattr -cr /Applications/wx-kit.app
```

未签名应用带 quarantine 时，Gatekeeper 可能连 CLI 一并拦截，因此安装后需要执行 `xattr -cr`。升级前先刷新本地配方：

```bash
brew update && brew upgrade --cask wx-kit
xattr -cr /Applications/wx-kit.app
```

### macOS / Linux：npm

```bash
# 国内网络可先指定 Electron 镜像
export ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
npm install -g @simiam/wx-kit
wx-kit --version
```

官方 npm `latest` 仍按渠道规约维护；包名带 scope，但安装后的命令仍是 `wx-kit`。

### 下载安装包

前往 [GitHub Releases](../../releases) 下载最新已发布版本 v0.10.1：

- Apple Silicon：`wx-kit-0.10.1-arm64.dmg`
- Intel Mac：`wx-kit-0.10.1.dmg`
- Windows：`wx-kit.Setup.0.10.1.exe`

当前安装包未签名、未公证。macOS 首次打开时需在“系统设置 → 隐私与安全性”中允许，或执行上面的 `xattr -cr`；Windows 遇到 SmartScreen 时选择“更多信息 → 仍要运行”。

## 当前可用 CLI

开发期在命令前使用 `npx electron .`；全局安装后直接使用 `wx-kit`。

| 目标 | 命令 |
|---|---|
| 下载文章 | `wx-kit download --url <URL> [--url <URL> ...] [--formats md,html,pdf,meta] [--out <目录>]` |
| 从文件批量下载 | `wx-kit download --urls-file <文件> [--no-video]` |
| 查看文库 | `wx-kit library list` |
| 搜索文库 | `wx-kit library search <关键词> [--account <公众号>]` |
| 导出创作素材 | `wx-kit library export --ids <id,id>` |
| 删除文章 | `wx-kit library remove --ids <id,id>` |
| 重建文库索引 | `wx-kit library rebuild` |
| 同步到 Astro 站点 | `wx-kit site sync ...` |
| 查看或修改有效设置 | `wx-kit settings get [键]` / `wx-kit settings set <键> <值>` |
| 检查更新 | `wx-kit update --check` |
| 查看版本或帮助 | `wx-kit --version` / `wx-kit --help` |

微信读书后端相关命令（v0.10.0 起复活）：

| 目标 | 命令 |
|---|---|
| 扫码登录微信读书 | `wx-kit login`（终端打印二维码） |
| 从文章链接识别公众号 | `wx-kit search --url <该号任意一篇文章链接>` |
| 检查订阅更新 | `wx-kit subscription check-now [--accounts a,b]` |
| 按发表日期查本地订阅文章（M55） | `wx-kit subscription digest --date <日期>` |
| 刷新下载后查今天（M55） | `wx-kit subscription digest --date today --download` |
| 登录态迁移 | `wx-kit session export/import` |
| 请求保护 | `wx-kit protection status/pause/resume` |

CLI 契约：stdout 只输出 JSON，stderr 输出进度；退出码 `0` 表示成功，`1` 表示业务失败，`2` 表示用法错误或需先登录。完整参数和示例见 [`agent/wx-kit-skill/`](agent/wx-kit-skill/)。

v0.10.1 的 digest 以 `library.json.publishTime` 按北京时间筛选，默认（包括 today）纯本地、无需登录。
仅今天允许显式 `--download`，会刷新最新 cover、下载缺失文章并重读文库，不受自动检查时间或自动下载设置影响；
非今天加该选项会在联网前返回 `DOWNLOAD_TODAY_ONLY`（退出码 2）。清单只代表本地保存内容，无法保证捕获
两次刷新间被 cover 覆盖的文章。无法确定发表时间时保留正文并告警，日报不将其归入任意日期，
通过 `unknownPublishTimeCount` 报告所选账号范围内的未知日期条目数；失败详情见 `failures`。

### 安装包内的 CLI

macOS 直接调用应用包内的可执行文件，不能使用 `open -a`，因为它不会可靠透传 stdout 和退出码：

```bash
/Applications/wx-kit.app/Contents/MacOS/wx-kit download \
  --url "https://mp.weixin.qq.com/s/XXX" \
  --formats md,meta \
  --out ~/Documents/wx-kit
```

Windows 默认路径：

```powershell
& "$env:LOCALAPPDATA\Programs\wx-kit\wx-kit.exe" download --url "..." --formats md,meta --out . > result.json 2> progress.log
```

Electron 在 Windows 是 GUI 子系统程序，stdout 不会回贴当前控制台；请重定向到文件，agent 集成优先使用 macOS 或 Linux。

## 功能说明

### 下载与保真

- 支持普通图文、文字消息、视频消息、图片消息等当前已适配的页面类型；
- 图片和视频会在解析文章的同一次流程中本地化，带时效签名的媒体 URL 不写入文库；
- `--no-video` 可以关闭视频下载，适合控制流量和磁盘占用；
- 未识别页面类型或媒体下载失败会写入 `warnings`，不会把可疑结果静默当成完全正常。

### 本地文库与素材供给

文库使用文件系统和 JSON 索引，不依赖数据库。`library export` 返回每篇文章的 `contentPath`，下游 agent 可以直接读取 Markdown 正文继续做分析或写作。GUI 也支持多选后“导出为素材”。

### 站点同步

`site sync` 会把文库文章生成到 Astro 站点的 `content/posts/<日期>-<slug>/` 中。目标目录已存在时不会覆盖，避免误伤已发布内容；wx-kit 只生成内容，不代替站点预览和发布。

## 架构

```text
Electron
├── Renderer：React GUI，只通过 preload 暴露的 API 调主进程
├── Main：IPC、CLI 分流、本地协议和 Electron 服务
├── CLI：Commander，stdout 为 JSON
└── Core：GUI 与 CLI 共用的解析、下载、文库和导出逻辑
```

- `electron/cli-dispatch.ts` 通过 `CLI_COMMANDS` 白名单判断是否进入 CLI；
- `src/core/` 不依赖 React 或 renderer；
- `src/renderer/` 不直接导入 core，只调用 `window.api`；
- 私有公众号后台实现目前保留在源码中，但产品入口与执行路径已停用。

## 开发验证

```bash
npm test
npm run lint
npm run typecheck
npm run test:e2e
npm run test:e2e:live-download
npm run build
```

本地 GUI e2e 覆盖当前有效界面与 fixture 下载闭环；`test:e2e:live-download` 使用隔离文库执行真实微信公众号文章 URL 的下载、历史、文库和阅读器验收。真实链路测试会访问微信，只在里程碑或发版验收时运行，不能用 fixture 结果代替。

## 项目状态

- 最新已发布版本：v0.10.1；GitHub Release 与 brew tap 已上线（npm `@simiam/wx-kit` 仍按可选渠道规约维护）；
- 下一版候选与完整发布史统一维护在 [`ROADMAP.md`](ROADMAP.md)，README 不再复制一份容易漂移的版本史。

需求、设计与开发约定分别见 [`docs/`](docs/)、[`ROADMAP.md`](ROADMAP.md) 和 [`AGENTS.md`](AGENTS.md)。

## License

[Apache-2.0](LICENSE)
