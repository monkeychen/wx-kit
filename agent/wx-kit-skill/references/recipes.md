# 组合任务范例

> 每个范例都是完整可跑的命令序列;`jq` 仅示意解析,任何 JSON 解析器皆可。

## 1. 全新机器:从零到下载第一篇(免登录路径)

```sh
# 检测 → 安装(mac 用 brew;Linux 换 npm 段)
command -v wx-kit >/dev/null || brew install --cask monkeychen/wx-kit/wx-kit
WX=${WX:-$(command -v wx-kit || echo /Applications/wx-kit.app/Contents/MacOS/wx-kit)}

"$WX" --version
"$WX" download --url "https://mp.weixin.qq.com/s/XXXX" --formats md,meta
"$WX" library list > /tmp/lib.json && jq '.items | length' /tmp/lib.json   # 确认入库
```

## 2. headless 服务器:导入登录态后批量爬取

```sh
# 在有图形界面的机器上(一次性):
wx-kit login && wx-kit session export -o s.json && scp s.json server:~/

# 服务器上:
wx-kit session import ~/s.json && rm ~/s.json      # {"ok":true,"valid":true} 才继续
wx-kit crawl --fakeid "MzIyMzA5NjEyMA==" --count 10 --formats md,meta > crawl.json
jq '{listed, succeeded, failed}' crawl.json
```

## 3. 关键词定向采集 → 导出素材清单(供写作/分析)

```sh
# 爬「数字生命卡兹克」最近 30 篇里标题含 AI 的,排除广告
wx-kit crawl 数字生命卡兹克 --count 30 --include "AI" --exclude "广告" --formats md,meta > c.json
jq '{listed, filteredOut, succeeded}' c.json

# 从文库挑出这些文章,导出素材清单(stdout 直接给含 contentPath 的 JSON)
wx-kit library search "AI" > hits.json
IDS=$(jq -r '[.items[].id] | join(",")' hits.json)
wx-kit library export --ids "$IDS" > material.json   # articles[].contentPath 即每篇 content.md 绝对路径
# 后续:逐篇读 contentPath 拿正文(交给 wx-kit-compose 或任意创作流程)
```

## 4. 订阅巡检(定时任务型)

```sh
wx-kit subscription check-now > check.json
jq '{newFound, failed, failures}' check.json
# 想知道「哪个号新增了几篇、下了几篇」看 results(逐号明细):
jq -r '.results[] | "\(.nickname): 新 \(.newFound) 篇, 已下载 \(.downloaded) 篇\(if .ok then "" else " [失败: \(.error)]" end)"' check.json
# newFound>0 且设置为「仅提示」时,新文章在 subscription list 各号的 newRefs 里;
# 想直接落库,把设置改成自动下载:wx-kit settings set subscriptionNewArticleAction download
```

只检查某几个号(不全量,省频控):

```sh
wx-kit subscription list | jq -r '.accounts[] | select(.subscribed) | "\(.nickname) \(.fakeid)"'
wx-kit subscription check-now --accounts <fakeid1>,<fakeid2>   # 只查指定号
```

## 5. 「昨天各号发了什么?」→ 直接拿到可读的素材(完整链路)

用户问「昨天/前天/7月23日各订阅号发了什么」时走这条。**注意第一步是你自己算日期。**

```sh
# ① 你(agent)把「昨天」换算成具体日期。CLI 只认 YYYY-MM-DD / today / yesterday,
#    传「昨天」「7月23日」会报 BAD_DATE —— 它刻意不猜,猜错是静默给错答案。
DATE=$(date -v-1d +%F)        # macOS;Linux: date -d yesterday +%F。你也可以直接算好写死。

# ② 只是想看清单(不取正文):纯查询,不下载不写库
wx-kit subscription digest --date "$DATE" > digest.json
jq -r '.articles[] | "\(.account)｜\(.title)｜\(if .downloaded then "已在库" else "未下载" end)"' digest.json

# ③ 要正文:同一条命令加 --download。缺的下、已有的跳过,**每篇直接带本地路径**
wx-kit subscription digest --date "$DATE" --download --formats md,meta > material.json
jq -r '.articles[] | select(.contentPath) | "\(.title)\t\(.contentPath)"' material.json
# 然后按 contentPath 逐个读 content.md 即可 —— 不必再跑 library export,也不必自己拼路径
```

**别用「先 digest 再逐个 download」那套**:那要你把「刚下的」和「本来就有的」两种结果合并,
`--download` 已经把这件事做完了(两者形状完全一致)。

要点:

- **订阅号多时先缩范围**:`--accounts <fakeid,fakeid>`(fakeid 从 `subscription list` 取)。
  全量 16 个号约 30–60 秒,stderr 有逐号进度;`--download` 阶段另有 `↓ [n/m] 标题`。
- **`--formats` 缺省跟设置走**(不是固定的 `md,html,meta`,那是 `crawl` 的缺省)。
  只当素材读的话 `md,meta` 就够;想省流量加 `--no-video`(单个视频可达上百 MB)。
- **`contentPath` 只在正文文件真存在时才有**(选了 `md`)。没有它就只有 `dir`,别硬拼路径去读。
- **拿不到的那几篇仍在清单里**:`unavailable: true` = 读者本就打不开(审核未通过/已删除),**重试无用**;
  只有 `error` 的是真故障(网络/频控),可以再试。
- **`itemShowType` 影响能拿到什么**:`5` 视频消息 / `10` 文字消息**没有长正文**,
  正文只是一段描述;当写作素材时价值与图文完全不同,挑素材前先看这个字段。
- 某号列表查失败进 `failures` 但**退出码仍是 0**(部分成功)——判断是否完整看 `failures`,不看退出码。

## 6. 每天拉所有公众号最近文章清单(默认排序即用)

```sh
wx-kit library list > lib.json        # 默认 --sort publish --order desc,最近发表在最前
jq '.items[:10] | map({title, account, publishTime, sourceUrl})' lib.json   # 取最近 10 篇
# 想按下载时间或升序:加 --sort download / --order asc
# 想筛选某号:--account <名>(配合 --sort 取该号最近 N 篇)
```

## 7. 把文库文章同步到个人站点(需先配 siteSyncPostsDir)

```sh
wx-kit settings get siteSyncPostsDir                 # 确认站点 content/posts 目录已配置
wx-kit library list > lib.json
jq -r '.items[:3] | .[] | "\(.id)  \(.title)"' lib.json    # 挑要同步的文章,为每篇想一个英文 slug

# 批量同步:id=slug 显式映射,避免位置错位
wx-kit site sync --ids <id1>,<id2> --slugs "<id1>=first-post,<id2>=second-post" > sync.json
jq '{succeeded, failed, results}' sync.json
# 失败常见原因:slug 非法(只能小写字母/数字/连字符)、slug 已存在(不覆盖)、该文章没下过 md 格式
# 成功后到站点目录跑 npm run dev 预览,确认再按站点流程发布
```

## 失败处理速查

| 现象 | 含义 | 动作 |
|---|---|---|
| 退出码 2 + `AUTH_REQUIRED` | 未登录/登录失效 | 走 SKILL.md 第二步 |
| `error` 含「频率限制(200013)」 | 微信频控 | 等 5–10 分钟再试,勿立即重试 |
| download 某篇 failed(标题空) | 文章已被删除 | 跳过即可,非环境问题 |
| `AMBIGUOUS` + candidates | 公众号重名 | 从 candidates 取 fakeid 用 `--fakeid` |

## 含视频的文章

**不用做任何事**——文章带视频就会一并下载(视频是内容,和图片一样,不在 `--formats` 里选)。

```sh
wx-kit download --url "https://mp.weixin.qq.com/s/XXX" --formats md,html,meta --out ./out
# 视频落在 <文章目录>/videos/video-N.mp4(自动取最高清档),md 里是可点链接,html 里是可播 <video>
jq -r '.items[] | "\(.title): \(.warnings // ["无告警"] | join("; "))"' out.json
```

批量抓取想省流量时关掉:

```sh
wx-kit crawl "某公众号" --count 200 --no-video --out ./out
```

**注意**:单个视频可达上百 MB(实测 1572×1080 一档 133MB,约 1 分钟下完)。
`--no-video` 时正文仍会注明「本文含 N 个视频(未下载)」,信息不丢。

