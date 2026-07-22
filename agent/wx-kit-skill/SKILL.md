---
name: wx-kit
description: |
  wx-kit(微信百宝箱)的安装与使用教程:下载微信公众号文章(单篇/批量/关键词筛选)、
  管理本地文库、订阅公众号更新、导出创作素材——全部经 CLI 完成,输出纯 JSON,面向 agent 自动化。
  当需要「下载某篇/某公众号的微信文章」「批量爬取公众号历史文章」「检查订阅号有没有更新」
  「把已下载文章导出为素材」时使用;发现 wx-kit 未安装时,本 skill 含自动安装路径。
  不用于:基于文库素材的写作编排(用 wx-kit-compose)。
---

# wx-kit 使用指南(agent 版)

wx-kit 是 GUI + CLI 同一二进制的桌面应用:**无参启动图形界面,带子命令进入 CLI**。
CLI 输出契约:**stdout 纯 JSON(数据),stderr 进度,退出码 0=成功 / 1=业务失败 / 2=用法或鉴权错误**。

## 第一步:确认安装

```sh
command -v wx-kit || ls /Applications/wx-kit.app/Contents/MacOS/wx-kit
```

两者皆无 → 按平台安装(装完 `wx-kit --version` 应输出裸版本号):

```sh
# macOS(Homebrew,装完整 .app;安装名三段式「用户/tap/包」,tap 过后可用短名 wx-kit)
brew update && brew install --cask monkeychen/wx-kit/wx-kit
# ⚠️ 必须紧跟这步:未签名 app 带 quarantine 标记时,连 CLI 调用都会被 Gatekeeper 卡住(挂起无输出)
xattr -cr /Applications/wx-kit.app

# macOS / Linux(npm,需 Node 20+;国内网络先设 electron 镜像;装完命令名就是 wx-kit)
export ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
npm install -g @simiam/wx-kit
```

> 升级:`brew update && brew upgrade --cask wx-kit`(brew 配方缓存在本地,先 update 否则升到旧版)/ `npm update -g @simiam/wx-kit`。

> brew 装完后二进制在 `/Applications/wx-kit.app/Contents/MacOS/wx-kit`;首次打开 **GUI** 会引导创建
> `~/bin/wx-kit` 快捷命令。npm 装完 `wx-kit` 直接在 PATH。
> ⚠️ 别自己 `ln -s` 建软链——macOS 上 Electron 经软链找不到 Helper 子进程,download 会崩;要建就用 wrapper 脚本(GUI 引导创建的就是)。

## 第二步:登录态(仅 search/crawl/subscription 需要;download 单篇不需要)

```sh
wx-kit auth-status        # → {"ok":true,"valid":true|false}
```

`valid:false` 时分场景:

- **有图形界面的机器**:`wx-kit login` 弹扫码窗,扫码后自动持久化,输出 `{"ok":true}`。
- **headless/服务器**:在能扫码的机器上 `wx-kit login && wx-kit session export -o s.json`,
  把文件传过来后 `wx-kit session import s.json`(自动探测有效性),用后删除文件。
  ⚠️ session 文件等同登录凭证,勿入仓库、勿留存。

## 原子能力速查

| 任务 | 命令 |
|---|---|
| 下载单篇(免登录) | `wx-kit download --url "https://mp.weixin.qq.com/s/XXX" --formats md,meta` |
| 搜公众号拿 fakeid | `wx-kit search <名称>` |
| 批量爬取最近 N 篇 | `wx-kit crawl <名称> --count 10 --formats md,meta` |
| 爬取 + 标题关键词筛选 | `wx-kit crawl <名称> --count 30 --include "AI,大模型" [--exclude "广告"]` |
| 列文库(默认发布时间降序) | `wx-kit library list > lib.json`(JSON 可能很大,重定向到文件再解析) |
| 最近文章清单 | `wx-kit library list`(默认 `--sort publish --order desc`,取前 N 条即最近 N 篇) |
| 搜文库 | `wx-kit library search <关键词>` |
| 导出素材清单 | `wx-kit library export --ids <id,id>` |
| 订阅号列表/立即检查 | `wx-kit subscription list` / `wx-kit subscription check-now` |
| 只检查某几个号 | `wx-kit subscription check-now --accounts <fakeid,fakeid>`(fakeid 从 `subscription list` 取) |
| 读/写设置 | `wx-kit settings get libraryRoot` / `wx-kit settings set libraryRoot <dir>` |
| 同步到个人站点 | `wx-kit site sync --ids <id> --slug <slug>`(按 Astro 站点规范生成目录,纯本地) |

格式可选 `cover,md,html,pdf,meta`;文章落盘在库根(默认 `~/Documents/wx-kit`)按公众号分目录,每篇一个文件夹(含 `content.md`/`meta.json` 等)。

## 频控纪律(重要)

微信有频率限制。wx-kit 内置串行下载 + 随机延迟 + 命中频控退避,**agent 不要自行并发多个 crawl、不要对失败立即重试**——频控失败(`RATE_LIMITED`)等几分钟再来。crawl 一次 ≤ 30 篇为宜。

## 细节按需查

- 逐命令参数与 JSON 输出结构:`references/commands.md`
- 组合任务范例(完整命令序列):`references/recipes.md`
