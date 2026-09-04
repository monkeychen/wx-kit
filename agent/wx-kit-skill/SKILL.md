# wx-kit 使用指南（agent 版）

wx-kit 是 GUI + CLI 同一二进制的桌面应用：无参启动 GUI，命中 CLI 命令白名单时进入 CLI。
CLI 契约：stdout 纯 JSON，stderr 输出进度；退出码 `0` 成功、`1` 业务失败、`2` 用法错误。

本文描述 v0.10.1 / M55 的当前行为。

## 1. 确认安装

```sh
command -v wx-kit || ls /Applications/wx-kit.app/Contents/MacOS/wx-kit
```

两者皆无时按平台安装，装完后 `wx-kit --version` 应输出裸版本号：

```sh
# macOS：Homebrew 安装完整 .app
brew update && brew install --cask monkeychen/wx-kit/wx-kit
xattr -cr /Applications/wx-kit.app

# macOS / Linux：npm，需 Node 20+
export ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
npm install -g @simiam/wx-kit
```

Homebrew 安装后，实际二进制位于 `/Applications/wx-kit.app/Contents/MacOS/wx-kit`。
不要自行用软链包装 Electron 应用；macOS 上软链可能导致 Helper 子进程定位失败。需要短命令时使用 GUI 创建的 wrapper。

## 2. 核心能力

| 任务 | 命令 |
|---|---|
| 扫码登录 | `wx-kit login`（刷新订阅最新 cover 前需要；本地日报无需登录） |
| 识别公众号 | `wx-kit search --url <公众号的任意一篇文章链接>` (返回该公众号的标识 ID) |
| 下载一篇或多篇文章 | `wx-kit download --url <URL> [--url <URL> ...] --formats md,meta` |
| 从文件批量下载 URL | `wx-kit download --urls-file <文件> [--no-video]` |
| 检查订阅更新 | `wx-kit subscription check-now`（自动下载时 `results[].articles` 给出该号逐篇明细） |
| 查订阅状态与最近检查记录 | `wx-kit subscription list`（`recentLog[]` 为最近 5 条检查记录，含自动下载明细；查自动下载历史用它，不用 check-now） |
| 查询文库中某天发表的订阅文章 | `wx-kit subscription digest --date <日期>`（默认零网络，包括 today） |
| 刷新下载后查询今天的文库日报 | `wx-kit subscription digest --date today --download`（仅今天允许） |
| 跨机器同步凭据 | `wx-kit session export -o ./creds.json` / `wx-kit session import ./creds.json` |
| 查看文库 | `wx-kit library list` |
| 搜索文库 | `wx-kit library search <关键词> [--account <公众号>]` |
| 导出素材清单 | `wx-kit library export --ids <id,id>` |
| 删除文章 | `wx-kit library remove --ids <id,id>` |
| 读写公开设置 | `wx-kit settings get [键]` / `wx-kit settings set <键> <值>` |

下载格式可选 `cover,md,html,pdf,meta`。文库根目录默认是 `~/Documents/wx-kit`，也可用 `--out` 指定。

默认行为：

- 联网刷新 cover 需要微信读书登录；`subscription list` 和不带 `--download` 的 `subscription digest` 不需要登录。
- `digest --date` 按北京时间的真实发表日期筛选 `library.json`，与下载时间无关；不读取调度状态决定是否联网。
- 只有用户明确要求刷新下载时才加 `--download`，它仅支持今天（或等于今天的具体日期），不受自动下载设置影响。
- 文章中的图片自动本地化；视频默认下载到文章目录，可用 `--no-video` 关闭；
- 同一文章已在文库时会跳过，不重复落盘。

## 3. 结果处理

下载结果的核心结构：

```json
{"ok":true,"total":1,"succeeded":1,"failed":0,"items":[{"url":"...","ok":true,"id":"...","title":"...","dir":"..."}]}
```

执行后至少检查：

- 顶层 `ok`、`succeeded`、`failed`；
- 每个 `items[]` 的 `ok`、`error`、`warnings`；
- 需要正文时确认文章目录内确实存在 `content.md`，不要只凭退出码判断内容可用。

digest 使用 `count/articles` 而非下载命令的 `total/items`。检查 `ok`、`failures`、`unknownPublishTimeCount` 和
`coverageNote`：未知发表时间的文章仍保存正文但不归入任何日期；计数覆盖所选账号全库，不是当天漏文数。
日报只列已入库文章（`downloaded:true`）。刷新失败即使返回部分本地文章，也会 `ok:false`、退出码 1。
每号 cover 只有最新一篇，无法补回两次刷新间被覆盖的文章；不要将文库日报说成完整发布史。

`library export` 输出的 `articles[].contentPath` 是正文绝对路径，正文不内联在 JSON 中；后续分析或写作需要再读取该文件。

## 4. 平台注意事项

- macOS 安装包：直接调用 `/Applications/wx-kit.app/Contents/MacOS/wx-kit`，不要用 `open -a`；
- Windows 安装包：Electron 是 GUI 子系统程序，stdout 不回贴当前控制台，必须重定向到文件。

## 细节按需查

- 逐命令参数与 JSON 输出：`references/commands.md`
- 当前有效任务的完整命令序列：`references/recipes.md`
