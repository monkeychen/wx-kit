# 当前有效任务范例

> 每个范例都是完整命令序列。`jq` 只用于展示 JSON 解析，可替换为任意解析器。
> v0.10.0 起，按公众号下载与订阅依赖**微信读书后端**复活；首次用这些能力前需 `login`。

## 1. 全新机器下载第一篇文章（不需要登录）

```sh
command -v wx-kit >/dev/null || brew install --cask monkeychen/wx-kit/wx-kit
WX=${WX:-$(command -v wx-kit || echo /Applications/wx-kit.app/Contents/MacOS/wx-kit)}

"$WX" --version
"$WX" download --url "https://mp.weixin.qq.com/s/XXXX" --formats md,meta > result.json
jq '{ok,total,succeeded,failed,items}' result.json
```

按 URL 下载不需要公众号后台登录，直接可用。

## 2. 下载用户给的一批文章链接

```sh
# urls.txt：每行一个微信公众号文章 URL
wx-kit download --urls-file urls.txt --formats md,html,meta --no-video > batch.json
jq '{ok,total,succeeded,failed,skipped}' batch.json
jq -r '.items[] | select(.ok == false) | "\(.url)\t\(.error)"' batch.json
```

大批量下载串行执行一份任务，不要并发启动多个 wx-kit 进程。不需要视频时明确加 `--no-video`。

## 3. 从文库挑素材

```sh
wx-kit library search "AI" > hits.json
jq -r '.items[] | "\(.id)\t\(.account)\t\(.title)"' hits.json

IDS=$(jq -r '[.items[:5][].id] | join(",")' hits.json)
wx-kit library export --ids "$IDS" > material.json
jq -r '.articles[] | "\(.title)\t\(.contentPath)"' material.json
```

后续按 `contentPath` 读取正文。清单只含元信息和路径，不含文章全文。

## 4. 查看最近下载或发布的文章

```sh
wx-kit library list --sort publish --order desc > lib.json
jq '.items[:10] | map({id,title,account,publishTime,sourceUrl,warnings})' lib.json
```

用文章作素材前，检查 `warnings` 和 `itemShowType`；视频/文字消息通常没有传统长正文。

## 5. 同步到个人站点

```sh
wx-kit library list > lib.json
jq -r '.items[:3][] | "\(.id)\t\(.title)"' lib.json

wx-kit site sync \
  --ids <id1>,<id2> \
  --slugs '<id1>=first-post,<id2>=second-post' \
  --posts-dir /path/to/site/content/posts > sync.json

jq '{ok,succeeded,failed,results}' sync.json
```

成功后到站点工程中预览并人工确认。wx-kit 不自动发布，且不会覆盖已存在的 slug 目录。

## 6. 按公众号下载 / 订阅（需先登录微信读书）

```sh
# (a) 登录一次（终端打印二维码，手机微信扫码并确认）
wx-kit login

# (b) 从「该号任意一篇文章链接」识别公众号，拿到 fakeid
wx-kit search --url "https://mp.weixin.qq.com/s/某篇该号的文章" > acct.json
FAKEID=$(jq -r '.account.fakeid' acct.json)

# (c) 订阅该号（GUI 在「订阅」页粘贴文章链接即可，CLI 用 subscription 检查）
wx-kit subscription check-now --accounts "$FAKEID" > check.json
jq '{accounts,newFound,failed,results,note}' check.json

# (d) 查某一天该号发了什么（--download 顺带补齐未下载的）
wx-kit subscription digest --date 2026-08-27 --download --accounts "$FAKEID" > digest.json
jq -r '.articles[] | "\(.title)\t\(.contentPath)"' digest.json
```

要点：

- 微信读书**无按名字搜索接口**——识别公众号必须用「该号任意一篇文章链接」，不是公众号名称；
- 登录态存于本机 `weread-creds.json`，会自动续期；headless 环境用 `wx-kit session export`/`import` 搬运；
- `crawl <fakeid> --count N` 当前后端**每次只返回最新一篇**（历史无法回补），仅适合「抓该号刚发的那篇」；日常增量订阅用 `subscription check-now`。

## 失败处理

| 现象 | 含义 | 动作 |
|---|---|---|
| `AUTH_REQUIRED` | 用 search/crawl/subscription 前未登录微信读书 | 先 `wx-kit login` 再重试 |
| `NOT_FOUND` | 文章链接读不出公众号标识（错误页/失效） | 换该号的另一篇文章链接重试 |
| 单篇 failed，提示文章不可访问 | 文章已删除、审核失败或违规下架 | 报告并跳过，不自动重试 |
| 单篇 failed，网络错误 | 文章页面或媒体下载失败 | 保留错误，等待用户决定是否重试 |
| `unavailable > 0` | 读者本就打不开的篇目（非下载故障） | 与 failed 区分报告，不要混为一谈 |
| `warnings[]` 非空 | 正文已落盘，但解析或媒体可能不完整 | 读正文前检查警告和产物 |
| `site sync` slug 冲突 | 目标目录已存在 | 换新 slug 或人工处理，不覆盖 |
