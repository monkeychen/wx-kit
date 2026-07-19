# wx-kit CLI 逐命令参考

> 所有输出为单行 JSON(stdout);进度走 stderr。以下结构均来自真机实测(v0.6.0)。
> 输出较大时(如 library list)重定向到文件再解析,别经管道截断。

## download — 下载文章(免登录)

```sh
wx-kit download --url <u> [--url <u2> ...] [--urls-file <file>] [--formats cover,md,html,pdf,meta] [--out <dir>]
```

- `--formats` 默认 `md,html,meta`;`--out` 缺省用设置里的库根。
- 输出:`{"ok":true,"total":1,"succeeded":1,"failed":0,"skipped":1?,"items":[{"url","ok","id","title","dir"?,"skipped"?,"error"?}]}`
- 已在库中的文章自动跳过(`skipped`);解析不到标题的(已删除文章)记 failed。
- 支持常规图文、纯文字消息、图文消息/小绿书三类页面。

## search — 搜公众号(需登录)

```sh
wx-kit search <名称>
```

输出:`{"ok":true,"list":[{"fakeid","nickname","alias","signature"}]}`;多候选时用 `fakeid` 精确指定后续 crawl。

## auth-status / login / session — 登录态

```sh
wx-kit auth-status                    # {"ok":true,"valid":true|false}(做一次真探测)
wx-kit login                          # 弹扫码窗;成功 {"ok":true};用户关窗 {"ok":false,error.code:"CANCELLED"} 退出码 2
wx-kit session export [-o <file>]     # 导出登录态(0600);无登录态 → error.code:"NO_SESSION" 退出码 1
wx-kit session import <file>          # 导入并立即探测:{"ok":true,"valid":true|false|null,"note"?}
                                      # 结构非法 → error.code:"CLI_ERROR" 退出码 2,不动既有 session
```

## crawl — 批量爬取(需登录)

```sh
wx-kit crawl <名称|--fakeid <id>> (--count <n> | --from YYYY-MM-DD --to YYYY-MM-DD)
  [--formats <csv>] [--include <kw,kw>] [--exclude <kw,kw>] [--out <dir>]
```

- `--include`/`--exclude`:按**标题**匹配(不分大小写),include 先筛、exclude 后筛(优先)。过滤在列表→下载之间,零额外请求。
- 输出:`{"ok":true,"fakeid","listed":N,"total","succeeded","failed","skipped","filteredOut"?:M,"items":[...]}`
  - `listed` = 过滤后进入下载的篇数;`filteredOut` = 被关键词筛掉的篇数(无过滤则缺省)。
- 名称多候选 → `error.code:"AMBIGUOUS"` + candidates,改用 `--fakeid`;找不到 → `NOT_FOUND`。

## library — 文库(免登录)

```sh
wx-kit library list [--out <dir>]              # {"ok":true,"items":[ArticleMeta...]}
wx-kit library search <关键词> [--account <名>] # 同上,按标题过滤
wx-kit library remove --ids <id,id>            # 删文章(文件+索引+历史联动)
wx-kit library rebuild                         # 从各篇 meta.json 重建索引(library.json 损坏时)
wx-kit library export --ids <id,id>            # {"ok":true,"count":N,"articles":[{...,"contentPath"}]}
```

ArticleMeta 字段:`id, title, author, account, publishTime, sourceUrl, digest, coverUrl, downloadTime, formats, dir`。
`library export` 直接在 stdout 输出素材清单,每篇含 `contentPath`(content.md 绝对路径),供下游创作/分析直接读文件(GUI 的「导出选中为素材」才是落盘成清单文件)。

## subscription — 订阅(check-now 需登录)

```sh
wx-kit subscription list        # {"ok":true,"accounts":[{fakeid,nickname,subscribed,watermark,lastCheckedAt,newRefs}],"lastRunAt","nextCheckAt"}
wx-kit subscription check-now   # {"ok":true,"accounts":N,"newFound":N,"failed":N,"failures"?:[{nickname,error}]}
```

`failures` 逐号给失败原因(如「微信频率限制(200013)」)。检查同时落盘日志与历史,与 GUI 同源。

## settings — 设置(免登录)

```sh
wx-kit settings get [键]        # 全量或单键:{"ok":true,"key","value"} / {"ok":true,"settings":{...}}
wx-kit settings set <键> <值>   # 常用键:libraryRoot、defaultFormats(逗号分隔)
```

## 退出码

`0` 成功(含 valid:false 这类「如实回答」);`1` 业务失败(下载失败/无 session 可导出);`2` 用法错误或需要登录(`AUTH_REQUIRED`/`CANCELLED`/`CLI_ERROR`)。
