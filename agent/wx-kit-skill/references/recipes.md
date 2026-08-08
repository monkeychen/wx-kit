# 当前有效任务范例

> 每个范例都是完整命令序列。`jq` 只用于展示 JSON 解析，可替换为任意解析器。

## 1. 全新机器下载第一篇文章

```sh
command -v wx-kit >/dev/null || brew install --cask monkeychen/wx-kit/wx-kit
WX=${WX:-$(command -v wx-kit || echo /Applications/wx-kit.app/Contents/MacOS/wx-kit)}

"$WX" --version
"$WX" download --url "https://mp.weixin.qq.com/s/XXXX" --formats md,meta > result.json
jq '{ok,total,succeeded,failed,items}' result.json
```

不要先运行 `login` 或 `protection`；这两个命令已随私有后台能力停用。按 URL 下载不需要公众号后台登录。

## 2. 下载用户给的一批文章链接

```sh
# urls.txt：每行一个微信公众号文章 URL
wx-kit download --urls-file urls.txt --formats md,html,meta --no-video > batch.json
jq '{ok,total,succeeded,failed,skipped}' batch.json
jq -r '.items[] | select(.ok == false) | "\(.url)\t\(.error)"' batch.json
```

大批量下载仍应串行执行一份任务，不要并发启动多个 wx-kit 进程。视频可能很大，不需要视频时明确加 `--no-video`。

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

使用文章作为材料前，检查 `warnings` 和 `itemShowType`；视频/文字消息通常没有传统长正文。

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

## 6. 旧的按公众号任务如何处理

如果用户提出“下载某公众号最近 20 篇”或“看看订阅号今天更新了什么”：

1. 明确说明公众号私有后台列表能力已停用；
2. 不执行 `search`、`crawl`、`subscription`、`login` 或 `session`；
3. 请用户提供目标文章 URL；
4. 收到 URL 后改用 `wx-kit download --url ...`。

命令返回 `MP_BACKEND_UNAVAILABLE` 时，不要通过恢复 protection、换 session、换公众号或自动重试来规避。

## 失败处理

| 现象 | 含义 | 动作 |
|---|---|---|
| `MP_BACKEND_UNAVAILABLE` | 调用了已停用的私有后台命令 | 改为让用户提供文章 URL |
| 单篇 failed，提示文章不可访问 | 文章已删除、审核失败或违规下架 | 报告并跳过，不自动重试 |
| 单篇 failed，网络错误 | 文章页面或媒体下载失败 | 保留错误，等待用户决定是否重试 |
| `warnings[]` 非空 | 正文已落盘，但解析或媒体可能不完整 | 读正文前检查警告和产物 |
| `site sync` slug 冲突 | 目标目录已存在 | 换新 slug 或人工处理，不覆盖 |
