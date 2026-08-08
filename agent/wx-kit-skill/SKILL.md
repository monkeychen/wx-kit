---
name: wx-kit
description: |
  wx-kit（微信百宝箱）的安装与 CLI 使用指南：按文章 URL 下载微信公众号文章、管理本地文库、
  导出创作素材、同步 Astro 站点，stdout 输出纯 JSON，面向 agent 自动化。
  当用户要「下载这篇微信文章」「批量下载这些文章链接」「搜索或导出已下载文章」
  「把文库文章同步到站点」时使用；发现 wx-kit 未安装时，本 skill 提供安装路径。
  不用于按公众号搜索历史文章或订阅更新：这些依赖微信私有后台的能力已经停用。
  基于文库素材写作请使用 wx-kit-compose。
---

# wx-kit 使用指南（agent 版）

wx-kit 是 GUI + CLI 同一二进制的桌面应用：无参启动 GUI，命中 CLI 命令白名单时进入 CLI。
CLI 契约：stdout 纯 JSON，stderr 输出进度；退出码 `0` 成功、`1` 业务失败、`2` 用法错误。

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

## 2. 当前有效能力

| 任务 | 命令 |
|---|---|
| 下载一篇或多篇文章 | `wx-kit download --url <URL> [--url <URL> ...] --formats md,meta` |
| 从文件批量下载 URL | `wx-kit download --urls-file <文件> [--no-video]` |
| 查看文库 | `wx-kit library list` |
| 搜索文库 | `wx-kit library search <关键词> [--account <公众号>]` |
| 导出素材清单 | `wx-kit library export --ids <id,id>` |
| 删除文章 | `wx-kit library remove --ids <id,id>` |
| 重建文库索引 | `wx-kit library rebuild` |
| 读写公开设置 | `wx-kit settings get [键]` / `wx-kit settings set <键> <值>` |
| 同步 Astro 站点 | `wx-kit site sync --ids <id> --slug <slug>` |
| 检查新版本 | `wx-kit update --check` |

下载格式可选 `cover,md,html,pdf,meta`。文库根目录默认是 `~/Documents/wx-kit`，也可用 `--out` 指定。

默认行为：

- 文章中的图片自动本地化；视频默认下载到文章目录，可用 `--no-video` 关闭；
- 支持当前已适配的图文、文字、视频和图片消息页面；
- 未适配的页面形态或媒体失败会进入 `warnings[]`，批量处理后应检查该字段；
- 同一文章已在文库时会跳过，不重复落盘。

## 3. 私有后台能力已停用

以下命令名为了兼容旧调用仍保留，但不会执行业务逻辑，也不会访问网络：

```text
search  crawl  login  auth-status  session  subscription  protection
```

它们统一返回：

```json
{"ok":false,"error":{"code":"MP_BACKEND_UNAVAILABLE","message":"微信公众号后台已限制查询其他公众号的文章列表，该功能已停用，未发起网络请求。","alternative":"请使用 wx-kit download --url <文章链接>"}}
```

退出码为 `1`。不要尝试扫码、导入 session、恢复 protection 或自动重试；这些动作无法恢复已失效的私有文章列表链路。正确替代路径是请用户提供文章 URL，然后调用 `download --url`。

旧订阅设置字段也已从 `settings get` 隐藏，写入时会被拒绝。当前可写字段：`libraryRoot`、`defaultFormats`、`historyRetentionDays`。

## 4. 结果处理

下载结果的核心结构：

```json
{"ok":true,"total":1,"succeeded":1,"failed":0,"items":[{"url":"...","ok":true,"id":"...","title":"...","dir":"..."}]}
```

执行后至少检查：

- 顶层 `ok`、`succeeded`、`failed`；
- 每个 `items[]` 的 `ok`、`error`、`warnings`；
- 需要正文时确认文章目录内确实存在 `content.md`，不要只凭退出码判断内容可用。

`library export` 输出的 `articles[].contentPath` 是正文绝对路径，正文不内联在 JSON 中；后续分析或写作需要再读取该文件。

## 5. 平台注意事项

- macOS 安装包：直接调用 `/Applications/wx-kit.app/Contents/MacOS/wx-kit`，不要用 `open -a`；
- Windows 安装包：Electron 是 GUI 子系统程序，stdout 不回贴当前控制台，必须重定向到文件；
- 涉及大量图片、视频或 PDF 的文章耗时较长，保留 stderr 进度，不要把进程无输出误判为挂死。

## 细节按需查

- 逐命令参数与 JSON 输出：`references/commands.md`
- 当前有效任务的完整命令序列：`references/recipes.md`
