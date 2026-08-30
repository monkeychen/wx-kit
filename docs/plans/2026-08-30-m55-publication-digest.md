# M55 · 基于本地文库发表日期的订阅日报

> 2026-08-30 确认的最终方案，需求契约见 `docs/PRD-v0.10.1.md` R4。实现与验收见末节；当前进度只在 `ROADMAP.md` 维护。
> 本方案替代此前“新增发现日志、每次 digest 都刷新 cover”的设计。不新增 `subscription-articles.json`。

## 目标与数据来源

回答“本地已保存的订阅公众号文章中，哪些发表于指定日期”。以 `library.json` 为唯一日报文章来源，
按真实 `publishTime` 筛选，与 `downloadTime`、订阅检查时刻无关。结果代表本地收集内容，不承诺完整发布史。

日常收集继续由既有自动检查与自动下载完成；建议开启，但不是本地查询的执行前提。未开启自动检查、
应用未运行或下载失败，都可能造成文库覆盖不足。当前 cover 每号只返回最新一篇，两次刷新之间被覆盖的
文章无法自动找回；提高检查频率只能降低漏检概率。

## CLI 契约

以下命令为 M55 源码行为（尚未发布）：

```sh
# 今天也默认纯本地，不联网、不下载
wx-kit subscription digest --date today

# 显式刷新所选账号最新 cover，下载缺失文章，再从文库返回今天的清单
wx-kit subscription digest --date today --download

# 历史日期纯本地查询
wx-kit subscription digest --date 2026-08-29
```

| 条件 | 行为 |
|---|---|
| 不带 `--download`，包括 today、yesterday、具体日期 | 读取本地订阅信息与 `library.json`；不联网、不检查登录态、不写文库或订阅状态 |
| 带 `--download`，日期解析后等于北京时间今天 | 刷新指定订阅账号（默认全部已订阅账号）的最新 cover，下载缺失文章，再重新读取文库并按今天的发表日期筛选 |
| 带 `--download`，日期不等于今天 | 参数错误，退出码 2；在读取凭据、构造请求或下载之前拒绝，解释不能通过当前 cover 回补历史 |

- `today`、`yesterday`、`YYYY-MM-DD` 都按 `Asia/Shanghai` 解析；具体日期等于今天时也允许 `--download`。
- 在命令开始时固定“今天”的判定，防止运行跨午夜后参数规则变化。
- 自动检查开关、daily/interval 模式、计划时间和 `lastRunAt` 均不决定 digest 是否联网。
- `--download` 明确要求本次下载，不受全局“仅提示/自动下载”策略影响，也不修改该设置。
- 保留 `--accounts`、`--out`；`--formats` 与 `--no-video` 仅作用于显式下载阶段。
- digest 不推进订阅游标、不修改 `newRefs` 或自动检查调度状态；不要直接复用带这些副作用的 `check-now` 编排。

刷新与日期筛选是先后两步：cover 返回的最新文章可能发表于昨天。带 `--download` 时仍可将该缺失文章保存，
但最终今天的清单只包含今天发表的文库文章，不能把旧文算成今天的新文。

## 发布时间与输出

- 复用并加固公开文章页 `publishTime` 解析；无时区的微信时间按北京时间解释，带时区的时间先转换到北京时间。
- 不使用 cover 的检查时间、下载时间、目录名或文件修改时间伪造发表日期。
- 发布时间为空或无法可靠解析时仍保存已获取正文，写明确告警；该文章不进入任何日期的 `articles`。
- 结果增加 `unknownPublishTimeCount`，统计本次所选账号范围内无法确定发表日期的文库文章，并给出告警。
  因这些文章日期未知，这个计数不是“查询当天缺失的篇数”。
- `articles` 保留 `account/title/publishTime/url/id/downloaded/dir/contentPath/warnings` 等既有字段；
  来源均为当前文库条目，因此 `downloaded:true`。只有实际存在对应正文文件时才给 `contentPath`。
- `count` 只计日期匹配的文库条目。刷新/下载失败另列于 `failures`，不将未知时间或未入库文章混入日报清单。
- 文库元数据新增可选 `accountId`，下载时保存已知账号 ID 或页面 biz，查询优先按稳定身份匹配，防止公众号改名后漏查；旧条目仍兼容长链 biz 和昵称，不强制迁移。
- `coverageNote` 明确说明清单基于本地保存内容，无法保证捕获两次刷新之间被 cover 覆盖的文章。
- 日期非法保持 `BAD_DATE`、退出码 2；非今天的下载请求用明确的参数错误码与退出码 2。
- 纯本地查询正常完成（包括空清单）退出码 0，无需登录。显式刷新未登录返回 `AUTH_REQUIRED`、退出码 2；
  刷新或下载有失败时保留可用本地清单与失败明细，`ok:false`、退出码 1，不能只凭本地有文章宣称刷新成功。

## 实施步骤

### T1 · 纯本地日报与日期校验

涉及 `src/core/digest-date.ts`、`src/core/subscription-digest.ts`、`src/cli/index.ts`，测试落在
`tests/core/digest-date.test.ts`、`tests/core/subscription-digest.test.ts`、`tests/cli/cli-contract.test.ts`。

- [x] 先写行为测试：发表日期和下载日期不同时按前者筛选；北京时间跨日正确；具体日期等于 today 时允许下载。
- [x] 增加无凭据本地查询、零网络、文件不变测试；过去/未来日期加 `--download` 必须在请求前拒绝。
- [x] 将日报纯查询改为从文库元数据选择文章，保留账号筛选和本地路径；移除纯查询分支对 weread 登录与列表取件器的依赖。
- [x] 测试通过后接入 CLI；使用注入时钟固定“今天”，不读取调度时间来决定查询副作用。

### T2 · 今天显式刷新并下载

涉及 `src/cli/index.ts`、`electron/services/weread-auth.ts`，复用 `src/core/download-queue.ts`、
`src/core/download-article.ts` 与 `src/core/subscription-refs.ts` 的身份、短链兼容和请求保护。

- [x] 先写行为测试：只刷新所选账号、已有文章跳过、下载后重读文库、旧发表日期不进入今天清单。
- [x] 验证全局自动下载设置开/关时显式 flag 行为相同；订阅游标、pending 与调度状态前后不变。
- [x] 仅在合法 `--download` 分支构造 cover 与下载依赖；不访问 `/web/mp/articles` 或旧 MP 后台接口。
- [x] 保持串行和现有间隔；记录刷新/下载失败，触发全局请求保护后停止后续请求，不以空清单掩盖故障。
- [x] 保护错误不得被图片、封面、视频或替代短链的容错逻辑吞掉；公众号改名后的新下载仍能按稳定 ID 查到。

### T3 · 缺失发表时间的可见性

涉及 `src/core/parse-article.ts`、`src/core/download-article.ts`、`src/core/subscription-digest.ts`，
测试覆盖解析、成功保存正文但有告警、日报排除未知日期与告警计数。

- [x] 先写测试：空值与不可解析时间不误归日期，无法确定发表时间不阻断正文保存。
- [x] 加固时间解析并通过现有 `warnings` 传递缺失时间信息，不建立“非空才能入库”的硬拒绝规则。
- [x] 对已确认的少量历史空值安排定向补全：先备份，依据原文证据更新 `meta.json` 和 `library.json`；
  若无法获取真实日期则保留空值与报告。不得在普通查询或启动时隐藏联网，不新增长期修复命令。

### T4 · 文档与验收

- [x] CLI 实现同批刷新 `README.md`、`agent/wx-kit-skill/SKILL.md`、`references/commands.md`、
  `references/recipes.md`，必要时同步 `agent/wx-kit-compose/` 中的调用示例。
- [x] 删除使用过去日期搭配 `--download` 的有效范例；注明本地查询不要求登录，日期不触发隐式下载。
- [x] 更新 PRD 验收、ROADMAP 与 devlog；区分已确认设计、代码实现、自动测试和真实链路结果。
- [x] 执行 test、lint、tsc、build；CLI 隔离测试证明默认零请求。真实 cover/下载验收另行记录，不能用 fixture 代替。

## 非目标与被替代方案

- 不新增 `subscription-articles.json`、数据库或发现记录维护机制。
- 不根据“是否过自动检查时间”暗中联网，不为历史日报刷新当前 cover。
- 不把 `newRefs` 作为第二份日报文章来源；本版不扩展成包含所有未下载/忽略文章的发布日志。
- 不要求 `publishTime` 永远非空，不用下载时间补假值，不因日期缺失拒绝保存正文。
- 不新增 `library repair-publish-time` 命令，不改变既有订阅调度与 GUI 操作语义。
- README 与 agent skill 已随源码更新，并注明已发布 v0.10.0 不具备该新契约；不提前修改发布版本号。

## 执行与验收记录（2026-08-30）

- 源码：本地日报、今天显式刷新、未知日期告警、稳定账号身份、全局停止错误传播均已实施。
- 自动验证：`npm test` 62 文件/519 项通过，`npm run lint`、`npx tsc --noEmit -p tsconfig.json` 退出码 0。
- 时区验证：日期与日报用例分别在 UTC、America/Los_Angeles 下通过，结果均为北京时间。
- 构建与 GUI：`npm run build` 双架构 DMG 退出码 0；`node tests/e2e/gui.e2e.mjs` ALL PASSED。未签名与 chunk 大小提示为现有构建限制。
- 真实链路：临时文库内首次 cover 刷新、公开页下载、发表时间与账号身份落盘成功；打包 CLI 无凭据查询真实发表日期成功，查询前后文库/订阅文件不变、未产生微信请求审计。
- 存量数据：两篇空时间文章依据原文解析和 ID 核对补齐，只更新对应 meta 与 library 的发表时间，备份在本次验收临时目录内。
- 现场证据（本机临时产物，不含凭据）：`/tmp/wxkit-m55-verify-1BNFSB/report.json`；备份 `/tmp/wxkit-m55-verify-1BNFSB/legacy-backup-bbv7VF/`。
- 独立审查提出的资源错误吞没、账号改名漏查、cover HTTP 鉴权停止问题均补回归修复，最终复核无新增发现。
- [x] 成功业务响应后同步 Chromium Cookie jar 到凭据文件；401/403 不覆盖凭据，快照写入失败不改变成功结果。单测已覆盖。
- [x] 真实跨进程重复刷新：有效扫码登录后，两个独立隔离 CLI 进程仅通过第一个进程持久化的凭据连续刷新 cover 均成功。当前服务响应未轮换 Cookie；轮换快照回写由传输层单测覆盖。
