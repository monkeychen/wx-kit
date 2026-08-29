# M55 · 基于真实发表时间的订阅日报设计

## 目标

让 `wx-kit subscription digest --date <日期>` 准确回答“已订阅公众号在该日期新发表了哪些文章”，
并用 `downloaded` 标识本地状态；显式增加 `--download` 时，仅下载尚未入库的文章。

## 已确认边界

- 微信读书 `/api/mp/cover` 只返回每个公众号最新一篇的身份、标题和短链，不含发表时间。
- 微信公众号公开文章页包含 `ct`、`oriCreateTime` 或可读 `createTime`，现有 `parseArticle` 已能解析。
- 每次只能发现 cover 当前最新一篇。若同一公众号在两次刷新之间连续发表多篇，被覆盖的早一篇无法找回。
- 提高检查频率只能降低漏检概率，不能消除该边界；产品与 CLI 输出必须如实说明。

## 核心设计

### 1. 持久化订阅文章发现记录

在文章库根目录新增 `subscription-articles.json`，继续使用原子写和路径锁，不引入数据库。

```ts
interface SubscriptionArticleRecord {
  sourceId: string       // cover reviewId，稳定身份
  fakeid: string
  nickname: string
  title: string
  url: string
  publishedAt: number    // 从公开文章页解析的 Unix 秒，绝不使用检查时刻冒充
  discoveredAt: number   // 本机首次发现时刻，Unix 毫秒
}
```

记录按 `sourceId` 去重；同一身份再次出现只允许更新标题、URL、昵称，不改首次发现时间。`downloaded`
不落盘，查询时从 `library.json` 实时派生，避免删除文章后状态漂移。

### 2. 发现与时间补全

抽出共享的“刷新每个订阅号最新文章”编排，供订阅检查和 `digest` 使用：

1. 读取 `/api/mp/cover`；
2. 若 `sourceId` 已在发现记录中，不再请求公开文章页；
3. 若是首次发现，经过现有请求保护网关读取公开文章页；
4. 用 `parseArticle` 解析真实 `publishTime` 并转换为 `publishedAt`；
5. 解析不到时间或页面请求失败时，该账号本轮记失败，不写伪时间、不吞掉身份，后续可重试；
6. 成功后写发现记录，再交给既有 `reviewId` 游标判断、待处理和自动下载流程。

订阅策略为自动下载时，时间补全与正文下载可能各读取一次文章页。本版不引入跨流程 HTML 缓存，优先保证
状态边界清晰；后续若真实性能数据证明必要，再单独优化。

### 3. digest 语义

`subscription digest` 保留现有命令与参数，但数据来源改为发现记录：

```sh
wx-kit subscription digest --date today
wx-kit subscription digest --date today --download
```

执行时先刷新指定账号的最新 cover，将首次发现文章补全并写入记录；随后按北京时间自然日过滤
`publishedAt`。查询不推进订阅水位、不修改 `newRefs`、不触发设置中的自动下载策略。

输出继续包含 `account/title/publishTime/url/id/downloaded/dir/contentPath/warnings/error/unavailable`；新增
顶层 `coverageNote`，明确“每号仅捕获刷新时最新一篇，可能漏掉两次刷新间被覆盖的文章”。

`--download` 继续只处理 `downloaded:false` 的条目；下载成功后返回统一的本地路径形状。无 `--download`
时不写文库。

### 4. 旧数据与兼容

- 不迁移 `subscriptions.json`、`library.json`、`history.json`。
- 新文件不存在时视为空记录；首次刷新会从当前 cover 开始积累，不能反推历史。
- 旧 `subscription digest` 的 CLI 命令名和参数保持兼容，但结果从“不可靠的伪时间”修正为真实发表时间。
- `agent/wx-kit-skill` 必须同步新的数据来源、`coverageNote` 和能力边界。

## 错误与退出码

- 单个账号刷新失败：其余账号继续，结果带 `failures[]`；至少一个账号成功则退出码 `0`。
- 全部账号失败：`ok:false`，退出码 `1`。
- 日期非法：保持 `BAD_DATE` 与退出码 `2`。
- 未登录：刷新无法执行，返回 `AUTH_REQUIRED`；本版不增加“仅查本地缓存”开关。

## 验收

- 文章页的真实发表日期与查询日期一致时进入清单，不一致时不进入。
- 同一 cover 重复刷新不重复请求文章页、不重复写记录。
- 发现记录跨进程持久化，删除文库文章后 `downloaded` 实时变为 false。
- 不带 `--download` 不写文库、不推订阅水位；带 flag 只下载缺失项。
- 两次刷新间多发可能漏检的边界出现在 CLI 输出和 skill 文档中。
- 单测、CLI contract、lint、tsc、build、GUI e2e 与真实 cover/文章页链路分别验收。
