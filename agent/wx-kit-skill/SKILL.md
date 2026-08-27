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

## 2. 核心能力

| 任务 | 命令 |
|---|---|
| 扫码登录 | `wx-kit login` (终端会显示二维码，必须扫码登录微信读书才能抓公众号列表) |
| 识别公众号 | `wx-kit search --url <公众号的任意一篇文章链接>` (返回该公众号的标识 ID) |
| 下载一篇或多篇文章 | `wx-kit download --url <URL> [--url <URL> ...] --formats md,meta` |
| 批量下载/抓取 | `wx-kit crawl <标识ID> --count 10` (注意: 当前接口限制每次只能获取该号的**最新一篇**文章) |
| 从文件批量下载 URL | `wx-kit download --urls-file <文件> [--no-video]` |
| 检查订阅更新 | `wx-kit subscription check-now` |
| 获取单日订阅摘要 | `wx-kit subscription digest --date today --download` |
| 跨机器同步凭据 | `wx-kit session export -o ./creds.json` / `wx-kit session import ./creds.json` |
| 查看文库 | `wx-kit library list` |
| 搜索文库 | `wx-kit library search <关键词> [--account <公众号>]` |
| 导出素材清单 | `wx-kit library export --ids <id,id>` |
| 删除文章 | `wx-kit library remove --ids <id,id>` |
| 读写公开设置 | `wx-kit settings get [键]` / `wx-kit settings set <键> <值>` |

下载格式可选 `cover,md,html,pdf,meta`。文库根目录默认是 `~/Documents/wx-kit`，也可用 `--out` 指定。

默认行为：

- 必须先登录微信读书 (`wx-kit login`)，才能使用 `search`, `crawl`, `subscription` 命令。
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

`library export` 输出的 `articles[].contentPath` 是正文绝对路径，正文不内联在 JSON 中；后续分析或写作需要再读取该文件。

## 4. 平台注意事项

- macOS 安装包：直接调用 `/Applications/wx-kit.app/Contents/MacOS/wx-kit`，不要用 `open -a`；
- Windows 安装包：Electron 是 GUI 子系统程序，stdout 不回贴当前控制台，必须重定向到文件。

## 细节按需查

- 逐命令参数与 JSON 输出：`references/commands.md`
- 当前有效任务的完整命令序列：`references/recipes.md`
