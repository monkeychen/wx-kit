---
name: wx-kit
description: |
  wx-kit（微信百宝箱）的安装与 CLI 使用指南：按文章 URL 下载微信公众号文章（图文/HTML/PDF/元数据）、
  下载墨问笔记（单篇/按作者批量，需 mocli）、管理本地文库、经微信读书通道检查并增量下载订阅公众号更新
  （每号每次仅最新一篇）、订阅墨问作者并检查新笔记、按真实发表日期查订阅日报、导出创作素材、
  基于本地文库生成可追溯选题（v0.12.0 当前 main 未发布，GUI 与 CLI 均需用户自备兼容模型 API Key）、同步 Astro 站点——stdout 输出纯 JSON，面向 agent 自动化。
  当用户要「下载这篇微信文章」「批量下载这些文章链接」「下载这篇墨问笔记」「批量下载某位墨问作者的文章」
  「检查订阅号有没有新文章」「订阅这个墨问作者」「查今天自动下载了什么」「查某天发表了哪些订阅文章」
  「搜索或导出已下载文章」「从文库找值得写的选题」「wx-kit 报错/出问题了帮我看看」时使用；发现 wx-kit 未安装时，本 skill 提供安装路径；
  排障先读诊断日志（v0.11.3 起 `~/Library/Application Support/wx-kit/logs/main.log`）。
  不用于：按公众号批量下载全部历史文章（列表接口已被服务端封禁，该能力不存在）；
  下载他人私密墨问笔记（按作者授权，不可获取）；完整文章写作、配图、排版、发布或流量预测。
---

# wx-kit 使用指南（agent 版）

wx-kit 是 GUI + CLI 同一二进制的桌面应用：无参启动 GUI，命中 CLI 命令白名单时进入 CLI。
CLI 契约：stdout 纯 JSON，stderr 输出进度；退出码 `0` 成功、`1` 业务失败、`2` 用法错误。

本文以 v0.11.3 已发布能力为基线，并标出 v0.12.0 当前 main 的未发布选题 GUI 与 `topics` 命令。安装包没有“选题”导航或 `topics` 命令时先检查版本，不把源码文档当成已发布行为。

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
| 下载墨问笔记（单篇/按用户批量） | `wx-kit mowen import <note-id|URL>` / `wx-kit mowen import --uid <uid>`（需 mocli） |
| 订阅墨问作者并检查更新 | `wx-kit mowen subscribe --keyword <名字>`（先看候选）→ 带 `--uid` 确认；`wx-kit mowen check-now` 检查更新 |
| 跨机器同步凭据 | `wx-kit session export -o ./creds.json` / `wx-kit session import ./creds.json` |
| 查看文库 | `wx-kit library list` |
| 搜索文库 | `wx-kit library search <关键词> [--account <公众号>]` |
| 导出素材清单 | `wx-kit library export --ids <id,id>` |
| 删除文章 | `wx-kit library remove --ids <id,id>` |
| 从本地文库生成选题（v0.12.0 main，未发布） | GUI“选题” / `wx-kit topics analyze --range 24h` |
| 从已保存候选生成简报（v0.12.0 main，未发布） | GUI 点候选后“生成选题简报” / `wx-kit topics brief --run <runId> --topic <topicId>` |
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

`topics analyze` 会把所选时间范围内的正文发送到用户配置的 OpenAI Chat Completions 兼容端点。CLI Key 只从 `WXKIT_AI_API_KEY` 环境变量读取，没有 `--api-key`；GUI 在“设置 → 选题 AI”保存，系统加密可用时持久化，否则只保存本次会话并明示。使用前应确认目标服务的数据处理规则。选题卡中的传播效果固定为未验证，不得把材料篇数说成推流概率。完整参数、状态和示例见 `references/commands.md` / `references/recipes.md`。

## 4. 平台注意事项

- macOS 安装包：直接调用 `/Applications/wx-kit.app/Contents/MacOS/wx-kit`，不要用 `open -a`；
- Windows 安装包：Electron 是 GUI 子系统程序，stdout 不回贴当前控制台，必须重定向到文件。

## 5. 排障：先读诊断日志（v0.11.3 起）

用户报「wx-kit 出问题/某功能不可用」时，第一步读诊断日志再动手，别盲猜：

```
~/Library/Application Support/wx-kit/logs/main.log
```

- JSON 行格式 `{time, level, domain, event, ...}`，已脱敏（敏感值显示 `«redacted:N»`）；
- 每次启动的 `startup/snapshot` 记录版本与 PATH/HOME/SHELL 环境（GUI 从 Dock 启动只有系统最小 PATH，是 mocli 类「装了却找不到」问题的根源，一眼可判）；
- `mocli/spawn·exit` 记录每次子进程调用的 argv/退出码/耗时与 stdout/stderr 首行；`mp-request/request` 记录微信/微信读书请求；`download/done·fail` 记录每篇下载结果；
- 5MB×3 滚动（`main.log` / `main.1.log` / `main.2.log`），无远程上报。
- v0.11.3 之前的版本没有该日志，旧版问题仍按各命令自身的 JSON `error` 字段排查。

## 细节按需查

- 逐命令参数与 JSON 输出：`references/commands.md`
- 当前有效任务的完整命令序列：`references/recipes.md`
