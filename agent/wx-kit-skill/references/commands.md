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
- `recentLog[].downloadDetail`（v0.10.6 起）：本轮检查的**每个号**都有条目——有新文章的号 `items` 为逐篇明细（`status` 五态：`downloaded`/`exists`/`failed`/`unavailable`/**`pending`**），无新文章的号 `items: []`（查过、无新）。判「某号下载了什么」按 `items` 非空过滤；
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

## mowen — 墨问笔记（下载 + 作者订阅）

前置：需要安装 mocli（`npm install -g @mowenxd/cli` 并 `mocli auth init`）。未安装时所有 `mowen` 命令返回 `MOCLI_NOT_FOUND` + 安装指引（退出码 1）。

```sh
wx-kit mowen detect                              # 检测 mocli 安装/版本/认证身份(moUid)
wx-kit mowen search-user --keyword <名字>         # 模糊搜用户(昵称+简介)，返回 uid/name/intro/homeUrl
wx-kit mowen list-user --uid <uid> [--filter all|album|fee|popular] [--recent 1h|24h|3d|7d|15d] [--count 20]
wx-kit mowen list-mine [--filter priv|fee|pub|cond-pub] [--count 20]   # 自己的笔记(含私密)
wx-kit mowen search --keyword <关键词> [--count 20]                     # 全站搜笔记(条目带 authorName/阅读数，跨作者)
wx-kit mowen import <note-id|URL>... [--expand-refs] [--formats 跟设置] # 单篇/多篇下载入库
wx-kit mowen import --uid <uid> [--count 20] [--expand-refs]           # 按用户批量下载
wx-kit mowen subscribe --keyword <名字>           # 只搜索：返回候选(uid/name/intro)，供用户确认
wx-kit mowen subscribe --keyword <名字> --uid <uid> # 确认订阅(不回补历史，水位=订阅时刻)
wx-kit mowen unsubscribe --uid <uid>
wx-kit mowen list                                 # 订阅列表(各作者 newCount/newNotes 摘要)
wx-kit mowen check-now [--uid <uid>]              # 立即检查订阅更新；是否自动下载由设置决定
```

- `import`：已删除/付费笔记如实失败（付费墙在服务端，不可绕过）；合集引用默认在正文原地渲染引用卡片（标题/摘要/作者/链接，付费子笔记如实标「标题不可见」），`--expand-refs` 才递归下载子笔记（深度 3，付费子笔记如实 unavailable）；图片自动本地化（OSS 签名 URL 有时效，同次流程下完）。
- `subscribe`：两步式——先不带 `--uid` 输出候选给用户确认（防同名误订阅），确认后带 `--uid` 入库；重复订阅返回 `ALREADY_SUBSCRIBED`（退出码 1）。
- `check-now`：水位比对（`publicAt > watermark` 判新），返回逐作者 `results[]`（`newFound`/`downloaded`/`existed`/`unavailable`）；mocli 失败归集到作者名下如实报 `failed`，**不代表没有新笔记**；检查日志与公众号订阅共用（`platform: 'mowen'` 区分）。
- `list`：`newNotes[]` 每条含 `status`（`pending` 待处理 / `downloaded` / `ignored`）；`newCount` 是 pending 数。

结果示意（`check-now`，自动下载策略下）：

```json
{ "ok": true, "authors": 1, "newFound": 4, "failed": 0,
  "results": [ { "uid": "...", "name": "池建强", "ok": true, "newFound": 4,
                 "downloaded": 2, "existed": 2, "unavailable": 0 } ] }
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

## topics — 本地文库选题（v0.12.0 当前 main，未发布）

`topics` 使用 OpenAI Chat Completions 兼容协议。运行时会把选定范围内的正文发送到用户配置的服务；它不是纯本地命令。

```sh
export WXKIT_AI_BASE_URL='https://provider.example/v1'
export WXKIT_AI_MODEL='model-name'
export WXKIT_AI_API_KEY='在自己的终端中填写'

wx-kit topics analyze [--range 24h|3d|7d|custom] [--from YYYY-MM-DD --to YYYY-MM-DD] \
  [--article <id...>] \
  [--base-url <url>] [--model <name>] [--out <文库根目录>]

wx-kit topics brief --run <runId> --topic <topicId> [--out <文库根目录>]
```

- 初始范围为最近 24 小时，按原文发表时间筛选；`custom` 必须同时给 `--from/--to`，包含结束日。
- `--article`（可重复或逗号分隔）为 M75 手动选篇：直接指定文库文章 ID 作素材，不做时间判定，与 `--range/--from/--to` 互斥；文库中找不到的 ID 以 `UNKNOWN_ARTICLES` 失败（退出码 2）。文章 ID 来自 `library list/search` 输出的 `id`。
- `--base-url` / `--model` 优先于同名环境变量；Key 固定读取 `WXKIT_AI_API_KEY`，没有 `--api-key`，避免进入 shell 历史。
- `analyze` 最多处理 30 篇有效文章和 120,000 个去重正文字符，超限会在模型请求前失败；不会静默截断或自动扩窗。
- 对模型的请求走 SSE 流式（M75）；不设总超时，长生成正常完成，中断方式是用户终止进程。`WXKIT_DEBUG=1` 可把与大模型的完整请求/响应打到 stderr（排障用）。
- stdout 返回 `{ok,status,runId,cards,timeExcludedCount,...}`。`completed` 可合法地没有候选；`partial` 代表有卡片也有校验失败；`failed` 是请求或验证失败，不能说成没有值得写的题目。
- `cards[].statistics.sourceAccountCount` 是材料中账号身份数，不代表独立事实来源；`distributionEvidence` 首版固定为 `unverified`。
- `brief` 读取本地 `result.json` 并生成 Markdown，不再次调用模型。结果保存在 `<库根>/topic-decisions/runs/<runId>/briefs/`。
- 退出码：完成/部分/材料不足为 `0`；供应商/分析失败为 `1`；参数错误、缺配置和取消为 `2`。

这是 v0.12.0 当前 main 的未发布开发能力。已安装 v0.11.3 没有该命令，不能据此排查成安装故障。

M70 起增加 GUI“选题”导航：先在“设置 → AI 模型”完成配置，再选 24 小时/3 天/7 天/自定义日期/手动选择文章分析。GUI 默认不选中任何候选；点选后才展开理由、材料依据和起笔结构。反馈、切换页签和生成简报都不会再调模型。M75 的 GUI 增强：「手动选择文章」弹层从文库搜索并勾选（上限 30 篇）；分析期间页面显示模型实时输出（正文与思考分段、自动滚动），运行中可随时取消，切走再回来进度与已生成内容不丢；没有总超时限制，长时间无响应会明确报空闲超时。

M73 把该设置升级为多厂商：选择厂商（智谱/千问/DeepSeek/Kimi/MiniMax/OpenAI/Google/自定义）和计费模式后端点自动确定（自定义需手填 base URL）；模型可从候选选也可自由输入；推理开关与五档等级（low/medium/high/extra/max）按厂商能力显示；保存前可“测试连接”验证端点、Key 和模型。注意 GUI 配置与上面 CLI 的 `WXKIT_AI_*` 环境变量互相独立：CLI 路径仍是 baseUrl/model/key 三项，不读厂商目录。

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
