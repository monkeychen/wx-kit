# 当前有效任务范例

> 每个范例都是完整命令序列。`jq` 只用于展示 JSON 解析，可替换为任意解析器。
> 联网刷新订阅需要微信读书登录；本地 digest 查询无需登录，显式刷新下载需要登录。

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

# (d) 从本地文库查该号指定日期发表的文章（无须登录、零网络）
wx-kit subscription digest --date 2026-08-27 --accounts "$FAKEID" > digest.json
jq -r '.articles[] | "\(.title)\t\(.contentPath)"' digest.json

# (e) 今天只查本地也不需要 --download
wx-kit subscription digest --date today --accounts "$FAKEID" > today.json

# (f) 用户明确要求刷新下载时才执行：仅今天允许，不依赖全局自动下载策略
wx-kit subscription digest --date today --download --accounts "$FAKEID" --formats md,meta --no-video > refreshed.json
jq '{ok,count,unknownPublishTimeCount,coverageNote,failures,articles}' refreshed.json

# (g) 查最近自动下载了什么（GUI 定时任务下载的也在这里；无须登录、零网络）
wx-kit subscription list > subs.json
jq '[.recentLog[] | select(.downloadDetail != null)
     | {time, trigger, downloaded, existed,
        items: [.downloadDetail[].items[] | {title, status}]}]' subs.json
```

要点：

- 微信读书**无按名字搜索接口**——识别公众号必须用「该号任意一篇文章链接」，不是公众号名称；
- 登录态存于本机 `weread-creds.json`，会自动续期；headless 环境用 `wx-kit session export`/`import` 搬运；
- `crawl` 已停用（列表接口被服务端按账号封禁）；要某号最新一篇用 `subscription check-now`，增量订阅不变。
- 查「最近自动下载了什么」用 `subscription list` 的 `recentLog[]`（最近 5 条，按 `time` 过滤日期，逐篇明细在 `downloadDetail[].items`）；`check-now` 只报告本次触发的一轮，不回看历史。
- 不得把过去日期与 `--download` 组合来回补历史；已有文库日报无法列出从未保存的漏文。
- `unknownPublishTimeCount` 不为零时应告知有文章无法归入日期；它不是指定日期的缺失篇数。

## 7. 墨问笔记：单篇下载 / 按作者批量（需 mocli）

```sh
command -v mocli >/dev/null || { echo '先安装: npm install -g @mowenxd/cli 并 mocli auth init'; }
WX=${WX:-$(command -v wx-kit || echo /Applications/wx-kit.app/Contents/MacOS/wx-kit)}

# (a) 单篇下载（URL 或裸 noteId 均可）
"$WX" mowen import "https://note.mowen.cn/detail/XXXX" --formats md,meta

# (b) 按作者批量：先用关键词搜作者，把候选给用户确认本尊
"$WX" mowen subscribe --keyword "作者名字"
#    → 候选里确认 uid 后直接下载该作者清单（不订阅）：
"$WX" mowen import --uid <uid> --count 20

# (c) 合集引用：默认在正文原地渲染引用卡片（标题/摘要/作者）；显式展开才递归下载子笔记
"$WX" mowen import "https://note.mowen.cn/detail/XXXX" --expand-refs
```

## 8. 墨问作者订阅与检查

```sh
# (a) 订阅：先搜索出候选（含 uid/name/intro），带 --uid 确认订阅
"$WX" mowen subscribe --keyword "作者名字" --uid <uid>

# (b) 查订阅列表与各作者待处理新笔记
"$WX" mowen list | jq '{authors: [.authors[] | {name, newCount}]}'

# (c) 检查更新（自动下载策略与公众号订阅共用设置；不下载则只入待处理清单）
"$WX" mowen check-now
```

要点：

- 墨问发现与订阅检查依赖 **mocli**（未安装时命令返回 `MOCLI_NOT_FOUND` + 安装指引，exit 1）；
- 订阅**不回补历史**：水位从订阅时刻起算，补历史用 `mowen import --uid`；
- 付费/私密笔记如实失败（`MowenNoteUnavailable`），不伪装成功；他人私密笔记不可获取；
- `check-now` 的检查日志独立于公众号订阅（`mowen-subscriptions.json`），逐作者明细在 `results[]`。

## 9. 从本地文库形成选题简报（v0.12.0 当前 main，未发布）

先在自己的终端配置服务。下面只写变量名，不要把真实 Key 记入脚本、仓库、聊天或问题单。

```sh
export WXKIT_AI_BASE_URL='https://provider.example/v1'
export WXKIT_AI_MODEL='model-name'
export WXKIT_AI_API_KEY='在自己的终端中填写'

# 默认最近 24 小时；正文会发送到上面配置的服务
wx-kit topics analyze --range 24h > topics.json
jq '{ok,status,runId,timeExcludedCount,cards:[.cards[]? | {id,question,angle,readerValues,statistics,distributionEvidence}]}' topics.json

jq -e '.ok == true and (.status == "completed" or .status == "partial") and (.cards | length > 0)' topics.json >/dev/null \
  || { echo '本次没有可生成简报的候选，请查看 status/error/排除信息'; exit 1; }

RUN_ID=$(jq -r '.runId' topics.json)
TOPIC_ID=$(jq -r '.cards[0].id' topics.json)
wx-kit topics brief --run "$RUN_ID" --topic "$TOPIC_ID" > brief.json
jq -r '.path' brief.json
```

`failed/cancelled` 没有可用卡片；`completed` 也可能合法返回空数组。上面的 `jq -e` 在取 `.cards[0]` 前完成门禁。`brief` 只整理已经验证的本地结果，不产生新的模型费用。

GUI 的等价流程是：“设置 → AI 模型”保存服务 → “选题”选时间范围 → “寻找选题” → 人工点选一张卡 → “生成选题简报”。简报自动复制到剪贴板，也可在 Finder 中显示文件。

## 失败处理

| 现象 | 含义 | 动作 |
|---|---|---|
| `AUTH_REQUIRED` | 联网刷新需要微信读书登录 | 显式下载前先登录；纯本地 digest 不要求登录 |
| `DOWNLOAD_TODAY_ONLY` | 非今天的日期与 `--download` 组合 | 去掉 flag 查询历史文库；只有今天允许刷新下载 |
| `MP_BACKEND_UNAVAILABLE` | `crawl` 已停用（服务端封禁列表） | 用 `subscription check-now` 拿最新一篇，或 `download --url` |
| `NOT_FOUND` | 文章链接读不出公众号标识（错误页/失效） | 换该号的另一篇文章链接重试 |
| 单篇 failed，提示文章不可访问 | 文章已删除、审核失败或违规下架 | 报告并跳过，不自动重试 |
| 单篇 failed，网络错误 | 文章页面或媒体下载失败 | 保留错误，等待用户决定是否重试 |
| `unavailable > 0` | 读者本就打不开的篇目（非下载故障） | 与 failed 区分报告，不要混为一谈 |
| `warnings[]` 非空 | 正文已落盘，但解析或媒体可能不完整 | 读正文前检查警告和产物 |
| `site sync` slug 冲突 | 目标目录已存在 | 换新 slug 或人工处理，不覆盖 |
| `MOCLI_NOT_FOUND` | mocli 未安装（墨问功能前置依赖） | 引导安装 `npm install -g @mowenxd/cli` 并 `mocli auth init` |
| `MOCLI_FAILED` / 笔记不可访问 | mocli 调用失败或笔记为付费/私密 | 如实报告，不重试付费墙（服务端拦截） |
