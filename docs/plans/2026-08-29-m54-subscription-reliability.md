# M54 · v0.10.1 订阅可靠性、全量待处理下载与可感知进度

> 需求契约：`docs/PRD-v0.10.1.md`。实施前提：微信读书文章列表为服务端账号级封禁；生产订阅只走
> `/api/mp/cover` 最新一篇，绝不重新接回 `/web/mp/articles` 或旧 MP 后台接口。

> **执行状态：代码已实施（2026-08-29）**。单测、lint、类型检查和 Electron 双架构构建已通过；真实
> `cover` 增量检查、真实文章 URL 下载和 GUI e2e 仍属于发版前的独立验收，不在本地 fixture 结果中冒充完成。

## 目标与边界

解决同一 cover 文章被反复报新的回归，为订阅页补一键处理全部待下载文章，并消除由无效探测与盲等造成
的性能体感问题。下载仍受现有全局请求保护控制，文章不并发。

## T1 · 把 `cover` 结果建模成身份游标（先写纯逻辑测试）

1. 在 `src/core/subscriptions.ts` 扩充 `SubscribedAccount`：新增可选 `latestArticleId?: string`，旧文件读入
   缺省为 `null`；增加一次原子更新方法，在成功检查时同时保存 `watermark`（如适用）、`latestArticleId` 与
   `lastCheckedAt`。
2. 新建纯 core 的 cover 检查决策函数/类型：输入账号已有游标、当前 `reviewId`、待处理引用和“本地已有”
   判定，输出 `newRefs`、是否推进游标与首次迁移行为。禁止以 `Date.now()` 伪造发布时间参与新旧判定。
3. 先写单测覆盖：首次投递一次、同 `reviewId` 二次为零、新 `reviewId` 投递、仅提示/忽略/下载失败后不重报、
   旧数据的 pending/文库命中建立游标但不重报。
4. 删除 `initialWatermark(... - 1)` 的 `cover` 专用语义与测试；保留现有 `watermark` 字段的历史兼容，不做
   破坏性 JSON 迁移。

## T2 · 收紧微信读书订阅取件器

1. 调整 `src/core/weread/parse-articles.ts` 和 `src/core/weread/client.ts`，让 `getLatestArticle` 的 `reviewId`
   完整进入订阅探测结果。
2. 将 `electron/services/weread-auth.ts` 的订阅取件器改为直接读取 `/api/mp/cover`；移除
   `listAllArticles` → `fallbackToCover` 的生产探测链。
3. 调整 `checkSubscriptions` 与 `runSubscriptionCheck` 的依赖契约，使列表时间水位与 cover 身份游标显式分流；
   检查成功后立刻保存正确的游标，待处理引用继续由 `newRefs` 管理。
4. 给适配器与服务编排补注入式测试，断言检查不构造 `/web/mp/articles`，且同一 cover 连续检查不会返回新文章。

## T3 · 补“下载全部待处理新文章”主路径

1. 在 IPC 新增 `subscriptions:downloadAllNew`：读取所有已订阅账号的 `newRefs`，按稳定账号顺序扁平为
   一个串行任务；为每篇保留所属账号，以便完成后只移除该账号真正完成的项。
2. 复用既有 `downloadRefs`、`DownloadQueue`、历史记录与“成功/已存在/不可访问移除，真实失败保留”规则；
   不复制下载实现，不新增并发。
3. 在 preload 与 `src/renderer/api.ts` 增加明确的批量请求/进度类型；进度事件携带总文章数、已完成数、当前
   账号和文章阶段。
4. 在 `Subscriptions.tsx` 计算全体 pending 的文章数与账号数；仅在大于零时显示一个全局按钮。下载期间统一
   禁用会竞争的检查、开关及行内下载动作，结束后 reload 并给出成功/跳过/待重试汇总。
5. 增加 IPC/核心测试：多账号全量下载、部分失败留存、重复项跳过、无 pending 时稳定空结果。

## T4 · 让等待阶段可见

1. 扩展 `ProgressEvent`（或增加兼容字段）表示：等待网关、正文、图片 `i/n`、视频 `i/n`、导出、完成、失败。
2. 从 `MpRequestGateway`、`downloadArticle`、`exportArticle` 注入最小必要的阶段回调；图片/视频循环只报告离散
   项目边界，不承诺网络字节级进度。
3. 订阅页把阶段翻译为短中文文案，显示当前公众号和 `已完成/总数`；保留现有行内单篇状态。
4. 测试下载阶段序列及 UI 关键文案；请求保护间隔测试保持原值，明确不以性能名义改小。

## T5 · 回归、文档与发布收尾

1. 更新 `docs/devlog/wx-kit-vibe-coding.md`，记录“缺发布时间的 latest-only 接口必须按身份游标去重”的规则，
   以及为何不探测已被证伪的列表端点。
2. 若 CLI 输出契约未变化，不修改 `agent/wx-kit-skill/`；若为批量下载或进度新增 CLI 能力，必须同步三处说明。
3. 执行 `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`、`npm run build`、`npm run test:e2e`。
4. 真实验收分开报告：使用隔离文库检查同一订阅两次（第二次零新文章），再以新的 cover 身份验证一次新增；
   下载真实文章 URL 验正文/图片/视频路径。真实请求受频控或外部服务限制时，不用 fixture 代替结论。
5. 按发版规约更新版本、README、发布说明和 brew tap；全部渠道核验后才声明 v0.10.1 发布完成。

## 完成定义

- `cover` 订阅以稳定文章身份而非伪时间判重；重复检查不再出现“有新文章 → 已存在”。
- 检查后可一键下载所有待处理文章，失败项可重试。
- 用户能看懂下载正在等待或处理什么；请求治理边界不退化。
- 所有离线、GUI 与真实链路验收按 PRD 第 6 节分别记录。

## 执行记录

- [x] T1-T2：`cover` 使用 `reviewId`/`latestArticleId` 判重，移除生产列表探测，旧订阅已下载文章建立游标且不重复提示。
- [x] T3：订阅页提供全局下载全部待处理文章，复用串行下载队列并保留真实失败项。
- [x] T4：下载队列透传正文、图片、视频、导出阶段；自动下载完成事件不会继续占用 busy 状态。
- [x] T5：ROADMAP、PRD、devlog 已同步；未改变 CLI 命令/参数/输出契约，agent skill 无需同步。
- [ ] 发版前真实链路：真实 `cover` 连续检查、真实文章 URL 下载、GUI e2e、版本 bump、Release 与 brew 渠道。
