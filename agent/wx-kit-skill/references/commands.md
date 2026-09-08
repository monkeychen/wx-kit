# wx-kit CLI 逐命令参考

> stdout 为 JSON，stderr 为进度。输出较大时重定向到文件再解析，不要用会截断数据的管道。
> v0.10.0 起，订阅依赖**微信读书（WeRead）后端**复活；`search`/`login`/`auth-status`/`subscription`/`session`/`protection` 可用。`crawl` 因列表接口被服务端按账号封禁（2026-08-28）再度停用。
> 下述 digest 契约从 v0.10.1 / M55 生效。

## 登录前置：login

```sh
wx-kit login          # 终端打印二维码，微信扫码并手机确认；成功后输出 { ok, vid, name }
```

- 刷新 cover 需要登录；`digest --download` 有订阅账号但未登录时返回 `AUTH_REQUIRED`（退出码 2）。
- `subscription list` 与默认 `subscription digest --date` 只读本地，无需登录；
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

## crawl — 按公众号批量下载（已停用）

```bash
wx-kit crawl <fakeid> --count N
# → { "ok": false, "error": { "code": "MP_BACKEND_UNAVAILABLE", ... } }（退出码 2，零网络请求）
```

> **停用（2026-08-28）**：微信读书列表接口被服务端**按账号**封禁，历史批量下载无解。
> 命令名保留是为了给旧脚本一个稳定的拒绝响应。要拿某号最新一篇：`subscription check-now`
> 或粘贴该文链接走 `download --url`。识别账号仍用 `search --url <文章链接>`。

## subscription — 公众号订阅

```sh
wx-kit subscription list                      # 列出订阅账号、水位、上次/下次检查
wx-kit subscription check-now [--accounts a,b] # 检查更新，是否自动下载由设置决定
wx-kit subscription digest --date <YYYY-MM-DD|today|yesterday> [--accounts a,b] [--out <目录>]
wx-kit subscription digest --date today --download [--accounts a,b] [--formats md,meta] [--no-video] [--out <目录>]
```

- `list`：返回 `accounts[]`（含 `fakeid`/`nickname`/水位）、`lastRunAt`、`nextCheckAt`、`recentLog[]`（v0.10.2 起：最近 5 条检查记录，新在前，与 GUI「检查记录」同源）。定时自动下载发生在 GUI 进程内，查「最近自动下载了什么」用 `recentLog`，`check-now` 只报告本次触发的一轮；
- **登录态失效（v0.10.5 起）**：`authExpired: true`、`recentLog` 落 `note: 'auth-expired'`、`check-now` 同样返回该 note——此时**不代表没有新文章**，应引导用户到设置页重新扫码登录，不要基于失效会话的结果下结论；
- `check-now`：按稳定文章身份检查更新，按设置提示或自动下载；返回逐号明细 `results[]`、`newFound`、`failed`。自动下载的号带 `results[].articles`（v0.10.2 起），为该号本次逐篇明细，与 `recentLog` 里 `downloadDetail[].items` 同构——`status` 四态 `downloaded`/`exists`/`failed`/`unavailable`（仅 `failed` 才有 `error`）；未走下载策略的号没有该字段。
- `digest --date`：只读本地订阅与文库，按 `publishTime` 的北京时间自然日筛选，默认零网络（today 也一样）。
- `--accounts` 从 `subscription list` 取 fakeid 即可（v0.10.5 起按身份归一匹配，`MP_WXS_` 与历史 base64 形态均可命中），默认全部已订阅账号。查询优先匹配文库 `accountId`，其次长链 `__biz`，历史数据两者皆无时才按本地订阅昵称精确匹配。新下载会保存已知账号身份，避免改名后漏查；缺少身份的旧短链条目仍可能受昵称变更影响。
- `--download` 只允许北京时间今天或等于今天的具体日期；非今天返回 `DOWNLOAD_TODAY_ONLY`、退出码 2，在联网前拒绝。
- 显式下载先读取所选账号的最新 cover，下载文库缺失文章，再重新读库筛选今天；最新 cover 若是旧文仍可能保存，但不会算作今天发表。
- 显式下载不受全局自动下载策略影响，不修改订阅游标、`newRefs`、调度和设置；请求仍受串行、间隔与全局熔断保护。
- `--formats` 缺省跟随设置，`--no-video` 关闭视频；二者仅在 `--download` 时生效。
- 缺失或无效 `publishTime` 不阻断正文保存；日报排除该文章，返回 `unknownPublishTimeCount` 和 `warnings`。
  该计数覆盖所选账号范围，不是查询当天的漏文数；不能用 `downloadTime` 代填。
- 日报正常（含空清单）退出码 0；刷新/下载有失败则保留本地清单，`ok:false`、退出码 1，错误放 `failures[]`。

结果示意（`list`，v0.10.2 起含 `recentLog`；无下载动作的记录不含 `kind`/`downloaded`/`existed`/`downloadDetail`）：

```json
{ "ok": true,
  "accounts": [ { "fakeid": "MP_WXS_3634850725", "nickname": "雷一言", "subscribed": true } ],
  "lastRunAt": 1760000000000, "nextCheckAt": null, "authExpired": false,
  "recentLog": [
    { "time": 1760000000000, "trigger": "auto", "accounts": 1, "newFound": 2, "failed": 0,
      "kind": "check", "downloaded": 1, "existed": 1,
      "downloadDetail": [ { "fakeid": "MP_WXS_3634850725", "nickname": "雷一言",
        "items": [ { "title": "早报", "status": "downloaded" },
                   { "title": "旧文", "status": "exists" },
                   { "title": "被删文", "status": "unavailable" },
                   { "title": "失败文", "status": "failed", "error": "timeout" } ] } ] } ] }
```

结果示意（`digest`，字段示例）：

```json
{"ok":true,"date":"2026-08-30","accounts":1,"count":1,"articles":[{"id":"2247483817_1","account":"示例号","title":"示例文章","publishTime":"2026-08-30T02:00:00.000Z","url":"https://mp.weixin.qq.com/s/EXAMPLE","downloaded":true,"dir":"/library/article","contentPath":"/library/article/content.md"}],"unknownPublishTimeCount":0,"coverageNote":"清单仅覆盖本地已保存文章；两次刷新间被 cover 覆盖的文章可能漏检。"}
```

`articles` 仅来自文库；`contentPath` 只在 Markdown 文件确实存在时返回；未下载或未知日期不混入文章清单。
`failures` 含账号昵称、错误，适用时附 `fakeid/url/code/unavailable`。不要用“有本地文章”判断刷新成功。

结果示意（`check-now`，自动下载的号带 `articles` 逐篇明细）：

```json
{ "ok": true, "accounts": 3, "newFound": 2, "failed": 0,
  "results": [ { "fakeid": "...", "nickname": "...", "newFound": 1, "downloaded": 1,
                 "articles": [ { "title": "早报", "status": "downloaded" },
                               { "title": "失败文", "status": "failed", "error": "timeout" } ] } ],
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
wx-kit settings set subscriptionNewArticleAction download|notify
wx-kit settings set downloadVideos true|false
```

订阅相关字段（`subscriptionAutoCheck`/`subscriptionScheduleMode`/`subscriptionCheckTime`/`subscriptionIntervalHours`/`subscriptionNewArticleAction`/`downloadVideos`）在 v0.10.0 已复活，可直接读写；`settings get` 不再对它们返回 `MP_BACKEND_UNAVAILABLE`。

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
