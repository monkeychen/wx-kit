# M75 — 手动选篇 · 无总超时 · 流式输出（2026-09-21 安哥三项反馈）

安哥用真实供应商跑通后提出：

1. 素材源只有"时间范围"，要能**指定某篇文章**作为素材；
2. 90s 总超时太短——AI 交互正常不该掐总时长，**等不及由用户点取消**；
3. 模型响应要走 **stream 模式**，终端与 UI 都能实时看到生成过程。

## 1. 手动选篇（core + CLI + GUI）

- `TopicWindowInput` 新增 `{ preset: 'manual', articleIds: string[] }`（非空、≤30 篇护栏沿用）。
- 手动模式**不做发表时间的纳入/排除判定**——用户指名就是要它，时间语义（unknown/future）不再适用；
  `TopicMaterialSnapshot.window` 改为 `TopicWindow | null`，新增 `selection: { kind: 'time-window' } | { kind: 'manual'; articleIds: string[] }`。
  历史 manifest/result 里 window 必有、无 selection——读取端容忍（brief 等消费点判空）。
- 选择函数：`selectTopicArticlesByIds(libraryArticles, ids)` → `{ articles, missing: string[] }`；
  找不到的 ID 显式报 `UNKNOWN_ARTICLES` 失败（部分缺失也报错——用户指名≠可静默丢弃）。
- CLI：`topics analyze --article <id>`（可重复）与 `--range` 互斥。
- GUI：素材范围 Select 增「手动选择文章」；选中后弹出文库勾选面板（Modal，复用 `libraryList`，
  显示标题/公众号/发表时间，支持搜索），已选篇目以标签行展示可移除。
- `TopicService.analyze` 入参 `window: TopicWindowInput` 原样传（主进程解析），返回加 `missingArticleIds`。

## 2. 超时策略

- `ChatCompletionsTopicModel` 默认**无总超时**（`timeoutMs` 不传即不掐）；显式传入仅测试/CLI 用。
- 保留 `MODEL_TIMEOUT` 分类：连接后**空闲 120s 无任何字节** → 报"服务长时间没有响应，可取消后重试"。
  流式下这条很容易触发不了（token 在动），但连接建立前挂死（DNS/TLS 黑洞）需要出口。
- UI 取消按钮已有（M70），措辞确认覆盖长任务场景。

## 3. 流式输出（SSE）——模型通道标准形态（2026-09-21 安哥追加：所有对模型的请求都走流）

- **共用 SSE 解析器** `src/core/topics/sse.ts`：`data: {json}` 行增量解析（处理跨 chunk 断行、
  `[DONE]`、CRLF），chat-completions 与 test-connection 共用——流式是通道的默认形态，
  不是某个功能的开关。
- `ChatCompletionsTopicModel` 请求体固定 `stream: true` + `Accept: text/event-stream`。解析
  `choices[0].delta.content`（正文）与 `delta.reasoning_content`（思考），累计 usage 取末个含
  usage 的块。第一版**不发 stream_options**（include_usage 非全商支持），usage 允许缺失。
- **test-connection 同步改流式**：最小请求 `stream:true`，测「首字节延迟 + 首 token 延迟」——
  比总耗时更早证明端点/Key/模型可用；结果结构增加 `firstTokenMs`。
- 兼容回退：响应 `content-type` 非 event-stream（不支持 stream 的端点）→ 按现有非流式路径解析
  全量 JSON，功能不倒退。
- 增量链路：`ChatCompletionsConfig.onDelta?(stage, kind:'content'|'reasoning', text)`（构造注入，
  `TopicModel` 接口不变，fixture 零改动）→ TopicService 持 `webContents`，**150ms 节流合并**发
  `topics:stream` 事件 `{ stage, kind, text（窗口内累计片段）, charCount }` → preload `onTopicsStream`。
- debug.ts：流式时逐 delta 写 stderr（终端实时滚动，与 workbuddy 体验对齐）。
- renderer：TopicRunStore 增 `stream: { stage, contentTail, reasoningTail, contentChars }`（尾部环形，
  各留 4000 字符）；Topics 页进度区下方加"实时输出"折叠面板：等宽小字号、自动滚底、思考与正文分段标注；
  结果落地后清空。

## 4. 非目标

- 不做"边流式边解析出候选卡"（输出是整份 JSON，校验仍需完整文本）；
- 不动 snapshot/validate 协议本体（prompt 契约见 M74）；
- 不做断点续传/重连；连接错误语义不变（NETWORK_ERROR）。

## TDD 步骤

1. `time-window.test.ts`：manual 输入解析、`selectTopicArticlesByIds`、护栏与 UNKNOWN_ARTICLES
2. `chat-completions.test.ts`：SSE 解析（content/reasoning/多行 data/末块 [DONE]）、非 stream 端点回退、
   无默认超时 + 空闲超时、usage 缺失容忍、onDelta 回调
3. `topics-service` 测试：manual 透传、stream 事件节流合并形状
4. `analyze.test.ts`：selection 进 manifest、manual 无时间排除
5. Renderer：`topic-run-store.test.ts` 增 stream 缓冲测试；UI 手测（dev 模式真供应商）
6. e2e：fixture 模型改发 SSE（真实解析路径进 e2e）；手动选篇流程走一遍
7. CLI：`--article` 解析 + 互斥；文档同步（commands.md/PRD/ROADMAP/devlog）
