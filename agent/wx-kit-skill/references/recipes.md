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
# newFound>0 且设置为「仅提示」时,新文章在 subscription list 各号的 newRefs 里;
# 想直接落库,把设置改成自动下载:wx-kit settings set subscriptionNewArticleAction download
```

只检查某几个号(不全量,省频控):

```sh
wx-kit subscription list | jq -r '.accounts[] | select(.subscribed) | "\(.nickname) \(.fakeid)"'
wx-kit subscription check-now --accounts <fakeid1>,<fakeid2>   # 只查指定号
```

## 5. 每天拉所有公众号最近文章清单(默认排序即用)

```sh
wx-kit library list > lib.json        # 默认 --sort publish --order desc,最近发表在最前
jq '.items[:10] | map({title, account, publishTime, sourceUrl})' lib.json   # 取最近 10 篇
# 想按下载时间或升序:加 --sort download / --order asc
# 想筛选某号:--account <名>(配合 --sort 取该号最近 N 篇)
```

## 6. 把文库文章同步到个人站点(需先配 siteSyncPostsDir)

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
