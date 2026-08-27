# wx-kit CLI 逐命令参考

> stdout 为 JSON，stderr 为进度。输出较大时重定向到文件再解析，不要用会截断数据的管道。
> v0.10.0 起，按公众号下载与订阅依赖**微信读书（WeRead）后端**复活；`search`/`crawl`/`login`/`auth-status`/`subscription`/`session`/`protection` 全部恢复可用。

## 登录前置：login

```sh
wx-kit login          # 终端打印二维码，微信扫码并手机确认；成功后输出 { ok, vid, name }
```

- 未登录时 `search`/`crawl`/`subscription`/`digest` 会返回 `AUTH_REQUIRED`（退出码 2）；
- 凭据存于 `<用户数据目录>/weread-creds.json`，自动续期；CLI 下无法扫码的 headless 环境可用 `session export/import` 搬运；
- GUI 下登录在「设置 → 微信读书」页内扫码，不另开窗口。

## search — 从文章链接识别公众号

```sh
wx-kit search --url <该公众号任意一篇文章的链接>
```

- 微信读书无按名字搜索接口，识别入口统一为「传入该号的任意一篇文章链接」；
- 链接形态：`https://mp.weixin.qq.com/s/...`（短链）或长链均可；
- 返回该号的 `fakeid`（订阅/批量下载用的账号标识）与昵称；已登录时顺带用 `/book/info` 校验收录状态并取权威名称。

结果示意：

```json
{ "ok": true,
  "account": { "fakeid": "MP_WXS_3634850725", "nickname": "雷一言",
               "wereadCover": "https://...", "wereadAuthor": "雷一言" } }
```

读不到公众号标识（错误页/失效链接）时返回 `NOT_FOUND`（退出码 1）。

## crawl — 按公众号批量下载

```sh
wx-kit crawl <fakeid> \
  [--count <N> | --from <YYYY-MM-DD> --to <YYYY-MM-DD>] \
  [--formats cover,md,html,pdf,meta] [--no-video] \
  [--include <csv>] [--exclude <csv>] \
  [-o <文库根目录>]
```

- `fakeid` 由 `search --url` 取得（bookId / 老 fakeid 形式均可）；
- `--count N` 取「最近 N 篇」，`--from/--to` 取日期范围；
- 图片自动本地化，视频默认下载，`--no-video` 关闭；`--include/--exclude` 按标题关键词过滤；
- 已入库文章自动跳过。

> **能力边界（v0.10.0 已知降级）**：微信读书 Web 端接口每次仅返回该号**最新一篇**文章，无法回补历史。因此 `crawl` 实际只会拿到最近发布的一篇；`--count`/`--from/--to` 在旧 MP 后端下才有意义，当前后端下仅最新一篇会被处理。日常**增量订阅**用 `subscription` 子命令。

输出为 `crawlAccount` 汇总：

```json
{ "ok": true, "total": 1, "succeeded": 1, "skipped": 0, "failed": 0,
  "filteredOut": 0, "unavailable": 0, "items": [ { "url": "...", "title": "...", "ok": true } ] }
```

`unavailable` 表示作者已下架/发布失败的读者本就看不到的篇目（非下载故障），混在 `failed` 里会误导，单独计数。

## subscription — 公众号订阅

```sh
wx-kit subscription list                      # 列出订阅账号、水位、上次/下次检查
wx-kit subscription check-now [--accounts a,b] # 立即检查全部(或指定)订阅号的新文章并下载
wx-kit subscription digest --date <YYYY-MM-DD|today|yesterday> [--download] [--accounts a,b]
```

- `list`：返回 `accounts[]`（含 `fakeid`/`nickname`/水位）、`lastRunAt`、`nextCheckAt`；
- `check-now`：对每个订阅号调微信读书取最新一篇，比水位新则下载；返回逐号明细 `results[]`、`newFound`、`failed`，并带 `note`（如「仅最新一篇可用，历史无法回补」）；
- `digest --date`：查已订阅号在某一天发了什么；默认只查询，`--download` 顺带把缺的文章下下来（输出带本地 `contentPath`）。

结果示意（`check-now`）：

```json
{ "ok": true, "accounts": 3, "newFound": 2, "failed": 0,
  "results": [ { "fakeid": "...", "nickname": "...", "newFound": 1, "downloaded": 1 } ],
  "note": "微信读书接口每次仅返回最新一篇，历史文章无法增量回补" }
```

## auth-status — 登录态

```sh
wx-kit auth-status [--verify]   # --verify 真实续期探测一次
```

- 无参：本地读取凭据，返回 `present`/`valid:null`/`name`；
- `--verify`：调微信读书续期接口，返回真实 `valid`。

## session — 凭据跨机器迁移

```sh
wx-kit session export -o ./wx-kit-weread-creds.json   # 导出微信读书凭据
wx-kit session import  ./wx-kit-weread-creds.json     # 导入到本机用户数据目录
```

headless 环境（无法扫码）用此把已登录机器的凭据搬过来，避免重新扫码。

## protection — 微信请求保护

```sh
wx-kit protection status | pause | resume
```

查看/暂停/恢复微信请求频控闸；`status`/`pause`/`resume` 均为零网络请求（除 `resume` 不会立即访问微信）。

## download — 按 URL 下载文章（不依赖微信读书登录）

```sh
wx-kit download \
  [--url <URL> ...] \
  [--urls-file <文件>] \
  [--formats cover,md,html,pdf,meta] \
  [--no-video] \
  [--out <文库根目录>]
```

- `--url` 可重复；也可用 `--urls-file` 逐行提供 URL；
- 图片自动本地化，视频默认下载；已入库文章自动跳过；
- 文章已删除或解析不到有效标题时记为失败；视频等非关键媒体失败写入 `warnings[]` 不抹掉正文。

## library — 本地文库

```sh
wx-kit library list [--sort publish|download|title] [--order asc|desc] [--account <名称>] [--out <目录>]
wx-kit library search <关键词> [--sort ...] [--order ...] [--account <名称>] [--out <目录>]
wx-kit library export (--ids <id,id> | --since YYYY-MM-DD | --account <名称> | --all) [--out <目录>]
wx-kit library remove --ids <id,id> [--out <目录>]
wx-kit library rebuild [--out <目录>]
```

- `list` / `search` 默认按发布时间降序；`export` 输出 `articles[].contentPath` 指向本地 `content.md`；
- `remove` 删除文章目录并联动索引；`rebuild` 从各 `meta.json` 重建 `library.json`。

ArticleMeta 常用字段：`id title author account publishTime sourceUrl digest downloadTime formats dir itemShowType videos warnings`。`itemShowType` 开放集合：`0` 图文 / `5` 视频 / `8` 图片 / `10` 文字 / `11` 发布通告。`warnings` 是「下载完成但结果可能不完整」的信号，用素材前应检查。

## site — 同步到 Astro 站点

```sh
wx-kit site sync --ids <id> --slug my-post [--posts-dir <目录>]
wx-kit site sync --ids <id1>,<id2> --slugs <id1>=a,<id2>=b [--posts-dir <目录>]
wx-kit site sync --account <公众号> --slugs-file <文件> [--posts-dir <目录>]
```

输出 `{ "ok": true, "postsRoot": "...", "succeeded": 1, "failed": 0, "results": [...] }`。slug 只能含小写字母、数字和连字符；目标目录存在时拒绝覆盖；有单篇失败时继续处理其余，退出码 `1`。

## settings — 设置

```sh
wx-kit settings get [键]
wx-kit settings set libraryRoot <目录>
wx-kit settings set defaultFormats md,html,meta
wx-kit settings set historyRetentionDays <1..3650>
wx-kit settings set subscriptionAutoCheck true
wx-kit settings set subscriptionScheduleMode daily|interval
wx-kit settings set subscriptionCheckTime 09:00
wx-kit settings set subscriptionIntervalHours 12
wx-kit settings set subscriptionPolicy download|notify
wx-kit settings set downloadVideos true|false
```

订阅相关字段（`subscriptionAutoCheck`/`subscriptionScheduleMode`/`subscriptionCheckTime`/`subscriptionIntervalHours`/`subscriptionPolicy`/`downloadVideos`）在 v0.10.0 已复活，可直接读写；`settings get` 不再对它们返回 `MP_BACKEND_UNAVAILABLE`。

## update / version / help

```sh
wx-kit update --check
wx-kit --version
wx-kit --help
wx-kit help <命令>
```

`update --check` 只查询 GitHub Release，不自动升级；`version` 不联网。

## 退出码

- `0`：成功；
- `1`：业务失败（下载失败、站点同步部分失败、登录态失效等）；
- `2`：命令用法错误或未登录（`AUTH_REQUIRED`）。
