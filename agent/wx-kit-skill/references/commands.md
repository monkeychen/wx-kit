# wx-kit CLI 逐命令参考

> stdout 为 JSON，stderr 为进度。输出较大时重定向到文件再解析，不要用会截断数据的管道。

## download — 按 URL 下载文章

```sh
wx-kit download \
  [--url <URL> ...] \
  [--urls-file <文件>] \
  [--formats cover,md,html,pdf,meta] \
  [--no-video] \
  [--out <文库根目录>]
```

- `--url` 可重复；也可用 `--urls-file` 逐行提供 URL；
- `--formats` 缺省取设置中的默认格式；
- 图片自动本地化，视频默认下载到 `videos/video-N.mp4`，`--no-video` 可关闭；
- 已入库文章自动跳过；文章已删除或解析不到有效标题时记为失败；
- 视频等非关键媒体失败不会抹掉已成功的正文，但会写入 `warnings[]`。

结果示意：

```json
{"ok":true,"total":2,"succeeded":1,"failed":0,"skipped":1,"items":[{"url":"...","ok":true,"id":"...","title":"...","dir":"..."}]}
```

## library — 本地文库

```sh
wx-kit library list [--sort publish|download|title] [--order asc|desc] [--account <名称>] [--out <目录>]
wx-kit library search <关键词> [--sort ...] [--order ...] [--account <名称>] [--out <目录>]
wx-kit library export (--ids <id,id> | --since YYYY-MM-DD | --account <名称> | --all) [--out <目录>]
wx-kit library remove --ids <id,id> [--out <目录>]
wx-kit library rebuild [--out <目录>]
```

- `list` / `search` 默认按发布时间降序，空发布时间放在末尾；
- `export` 输出 `articles[].contentPath`，指向本地 `content.md`，正文不内联；
- `remove` 删除文章目录，并联动文库索引与历史；
- `rebuild` 从各文章目录的 `meta.json` 重建 `library.json`。

ArticleMeta 常用字段：

```text
id title author account publishTime sourceUrl digest downloadTime formats dir
itemShowType videos warnings
```

`itemShowType` 是开放集合。已知值包括 `0` 图文、`5` 视频、`8` 图片、`10` 文字、`11` 发布通告。`warnings` 是“下载完成但结果可能不完整或不准确”的信号，使用素材前应检查。

## site — 同步到 Astro 站点

```sh
wx-kit site sync --ids <id> --slug my-post [--posts-dir <目录>]
wx-kit site sync --ids <id1>,<id2> --slugs <id1>=a,<id2>=b [--posts-dir <目录>]
wx-kit site sync --account <公众号> --slugs-file <文件> [--posts-dir <目录>]
```

输出：

```json
{"ok":true,"postsRoot":"...","succeeded":1,"failed":0,"results":[{"id":"...","title":"...","slug":"...","ok":true,"dir":"..."}]}
```

slug 只能含小写字母、数字和连字符。目标目录存在时拒绝覆盖；有单篇失败时继续处理其余文章，最终退出码为 `1`。wx-kit 只生成内容，不自动预览或发布站点。

## settings — 设置

```sh
wx-kit settings get [键]
wx-kit settings set libraryRoot <目录>
wx-kit settings set defaultFormats md,html,meta
wx-kit settings set historyRetentionDays <1..3650>
```

全量 `settings get` 不显示已退场的订阅字段。直接读取或写入旧订阅字段返回 `MP_BACKEND_UNAVAILABLE`，不会改变原有本地数据。

## update / version / help

```sh
wx-kit update --check
wx-kit --version
wx-kit --help
wx-kit help <命令>
```

`update --check` 只查询 GitHub Release，不自动升级；`version` 不联网。

## 已停用命令

```text
search  crawl  login  auth-status  session  subscription  protection
```

无论是否补齐旧参数，命令都会在解析业务参数前返回：

```json
{"ok":false,"error":{"code":"MP_BACKEND_UNAVAILABLE","message":"微信公众号后台已限制查询其他公众号的文章列表，该功能已停用，未发起网络请求。","alternative":"请使用 wx-kit download --url <文章链接>"}}
```

退出码为 `1`；不会访问微信，也不会误开 GUI。它们保留命令名和旧实现源码，仅用于兼容和未来重新评估。

## 退出码

- `0`：成功；
- `1`：业务失败，例如下载失败、站点同步部分失败、私有后台能力已停用；
- `2`：命令用法错误。
