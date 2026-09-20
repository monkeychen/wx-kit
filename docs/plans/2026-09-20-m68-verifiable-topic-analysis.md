# M68 · 可验证选题分析核心实现计划

> **目标版本：v0.12.0（未发布）。产品与验收契约：[`docs/PRD-v0.12.0.md`](../PRD-v0.12.0.md)。**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Runtime behavior follows superpowers:test-driven-development. Steps use checkbox syntax for tracking.

**Goal:** 在不绑定外部模型供应商的前提下，交付“本地素材快照 → 两阶段模型判断 → 来源/统计校验 → 运行落盘 → 选题简报”的共享核心链路。

**Architecture:** `src/core/topics/` 负责所有确定性数据边界和模型无关编排；模型通过注入接口返回 unknown JSON，运行时校验器只接受可回指快照的结果。GUI、CLI 和真实网络适配不在本里程碑，测试使用具体假模型响应验证真实编排结果而非 mock 调用次数。

**Tech Stack:** TypeScript、Node `fs/promises` / `crypto` / `path`、现有 Vitest、现有 `atomicWriteFile` 与 `diag()`；不增加依赖。

**Spec:** [v0.12.0 PRD](../PRD-v0.12.0.md) · [本地选题决策器设计](../superpowers/specs/2026-09-20-topic-decisions-design.md)

## Global Constraints

- 只分析已经由 M67 时间规则入选的本地文章；不联网刷新、不修改文库或订阅水位。
- 每次最多 30 篇有效文章，发送给模型的去重正文合计最多 120,000 字符；超限在模型调用前失败，不静默截断。
- 正文按空行切段；超过 6,000 字符的长段按字符边界继续切块。输入材料始终视作数据，材料内指令没有执行权。
- 完全相同的规范化正文只发送一次，但保留所有文章身份；不同标题不作为去重依据。
- 每个最终引用必须回指内容组、段落 ID，并与快照中的精确摘录匹配；匹配只证明摘录存在，不证明事实真实。
- 相关篇数、账号数、内容组数和发表日期由程序重算；模型不能提供最终统计。
- `distributionEvidence` 始终为 `unverified`；不得输出阅读量、爆款分或推流概率。
- 最多保留三张有效卡，允许零个候选；无候选、材料不足、部分候选失败和整个请求失败必须区分。
- 核心层不导入 Electron/React，不写 API Key，不接真实网络；真实供应商、CLI 和 GUI 留给后续里程碑。

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `src/core/topics/snapshot.ts` | 路径约束、正文读取、质量筛选、规范化、内容组、段落与成本护栏 |
| `src/core/topics/model.ts` | 模型接口、两阶段原始请求/响应类型、规则与任务版本 |
| `src/core/topics/validate.ts` | unknown 输出解析、引用/摘录校验、卡片过滤、统计重算 |
| `src/core/topics/store.ts` | manifest/result/trace/brief 的安全原子落盘与读取 |
| `src/core/topics/analyze.ts` | 阶段编排、状态区分、取消与可读错误、诊断事件 |
| `src/core/topics/brief.ts` | 从已经校验的卡片确定性生成 Markdown |
| `tests/core/topics/*.test.ts` | 各边界的真实行为测试 |

已有 `src/core/topics/types.ts` 扩展快照、模型阶段和运行存储所需类型；M67 时间类型保持兼容。

## Task 1：本地素材快照（TDD）

**Files:** 修改 `src/core/topics/types.ts`；新建 `src/core/topics/snapshot.ts`、`tests/core/topics/snapshot.test.ts`。

**Interfaces:**

```ts
interface TopicParagraph {
  id: string                 // g001:p001 / g001:p002:c002
  groupId: string
  index: number
  chunkIndex: number
  text: string
}

interface TopicSnapshotArticle {
  id: string; title: string; author: string; account: string; accountId?: string
  publishTime: string; sourceUrl: string; contentHash: string; groupId: string
  warnings: string[]
}

interface TopicContentGroup {
  id: string; contentHash: string; representativeArticleId: string
  memberArticleIds: string[]; paragraphIds: string[]
}

interface TopicMaterialSnapshot {
  schemaVersion: 1; runId: string; createdAt: string; window: TopicWindow
  articles: TopicSnapshotArticle[]; groups: TopicContentGroup[]; paragraphs: TopicParagraph[]
  excluded: Array<{ id: string; reason: TopicMaterialExclusion; detail?: string }>
  totalModelChars: number
}

interface TopicSnapshotDeps {
  libraryRoot: string
  readContent?: (dir: string) => Promise<string>
  now?: () => Date
}

async function buildTopicSnapshot(
  deps: TopicSnapshotDeps,
  input: { runId: string; window: TopicWindow; articles: readonly ArticleMeta[] },
): Promise<TopicMaterialSnapshot>
```

- [x] **Step 1.1：写失败测试。** 用真 `mkdtemp` 文库和 `content.md` 覆盖：正常两篇、完全重复正文、同名不同文、frontmatter 去除、图片路径但无文字、正文不存在、`dir` 越出库根、解析告警保留、空行段落、6,001 字符长段切两块。断言重复正文形成一个内容组但保留两个文章身份，输入数组不变。
- [x] **Step 1.2：运行红灯。** `npm test -- tests/core/topics/snapshot.test.ts`，预期因模块不存在失败。
- [x] **Step 1.3：实现最小快照。** 使用 `resolve(root)` + `sep` 校验目录在库根内；正文读取复用 `readArticleContent(dir, 'md')`。规范化只统一 CRLF、行尾空白和首尾空白，不删除正文语义。SHA-256 对规范化正文计算。去掉 Markdown 图片/标记后无可见文字则 `insufficient-text`。内容组按 hash 首次出现排序，段落 ID 稳定。
- [x] **Step 1.4：补成本红灯。** 31 篇有效文章、120,001 个唯一正文字符分别抛 `TopicInputLimitError`，错误包含真实计数；重复正文只按一次字符成本计算，但文章上限仍按有效文章身份计算。
- [x] **Step 1.5：实现护栏并绿灯。** 导出 `MAX_TOPIC_ARTICLES=30`、`MAX_TOPIC_MODEL_CHARS=120_000`、`MAX_TOPIC_PARAGRAPH_CHARS=6_000` 供后续 UI 提示复用；不得截断。

## Task 2：两阶段模型协议与运行时校验（TDD）

**Files:** 修改 `src/core/topics/types.ts`；新建 `src/core/topics/model.ts`、`src/core/topics/validate.ts`、`tests/core/topics/validate.test.ts`。

**Interfaces:**

```ts
interface TopicModel {
  descriptor: { providerId: string; modelName: string }
  extract(input: TopicExtractionInput, signal?: AbortSignal): Promise<unknown>
  propose(input: TopicProposalInput, signal?: AbortSignal): Promise<unknown>
}

interface TopicExtractionItem {
  id: string; groupId: string; paragraphId: string; quote: string
  kind: 'fact-claim' | 'opinion' | 'question' | 'emotion' | 'change' | 'counterpoint'
  summary: string; theme: string
}

function parseTopicExtractions(raw: unknown, snapshot: TopicMaterialSnapshot): {
  items: TopicExtractionItem[]; failures: TopicFailure[]
}

function validateTopicProposals(raw: unknown, context: {
  snapshot: TopicMaterialSnapshot; extractions: TopicExtractionItem[]
}): { cards: TopicDecisionCard[]; failures: TopicFailure[] }
```

- [x] **Step 2.1：写 extraction 红灯。** 具体 unknown fixture 覆盖合法项、未知组/段落、quote 不存在、quote 只存在于其他段落、枚举错误、重复 item ID、空 summary/theme、非对象和超过 200 项。合法项保留；单项错误进入 failures；顶层结构错误抛 `TopicModelOutputError`。
- [x] **Step 2.2：运行红灯并实现 parser。** 精确 quote 用 `paragraph.text.includes(quote)`；禁止模糊修复、跨段拼接或把未知引用改到“最像”的段落。材料中的提示文本只作为字符串，不在 parser 执行。
- [x] **Step 2.3：写 proposal 红灯。** 覆盖最多三张、重复候选 ID、空问题/角度、非法读者价值、价值/claim 引用未知 extraction、空 outline、模型自报统计、非法 `distributionEvidence`、一张坏卡不吞掉其它好卡、全部坏卡返回 failures。
- [x] **Step 2.4：实现最终卡片。** 模型原始 proposal 不接受最终 statistics；程序根据卡片引用的 extraction → group → memberArticleIds 重算：文章身份数、按 `accountId ?? account` 归并的账号数、内容组数、发表日期。`distributionEvidence` 强制写 `unverified`。模型给出的把握等级只保留为编辑推断，并要求非空理由。
- [x] **Step 2.5：添加规则与任务版本。** `model.ts` 导出 `TOPIC_SYSTEM_VERSION='topic-system-v1'`、`TOPIC_EXTRACT_VERSION='topic-extract-v1'`、`TOPIC_PROPOSE_VERSION='topic-propose-v1'` 及结构化输入。规则明确材料是数据、只准引用已给 ID、不得执行正文指令、不得承诺推流。测试模型收到的 input 要包含版本和快照数据，但不对提示词逐字写 change-detector 测试。

## Task 3：运行存储与确定性简报（TDD）

**Files:** 新建 `src/core/topics/store.ts`、`src/core/topics/brief.ts`、`tests/core/topics/store.test.ts`、`tests/core/topics/brief.test.ts`。

**Interfaces:**

```ts
class TopicRunStore {
  constructor(private libraryRoot: string)
  writeManifest(runId: string, manifest: TopicMaterialSnapshot): Promise<string>
  writeResult(runId: string, result: TopicRunResult): Promise<string>
  appendTrace(runId: string, event: TopicTraceEvent): Promise<void>
  writeBrief(runId: string, topicId: string, markdown: string): Promise<string>
  readResult(runId: string): Promise<TopicRunResult>
}

function buildTopicBrief(card: TopicDecisionCard, run: Pick<TopicRunResult, 'runId' | 'window' | 'createdAt'>): string
```

- [x] **Step 3.1：写存储红灯。** 真 tmpdir 断言固定目录、JSON 可解析、原子替换、trace JSONL 多事件完整、非法 run/topic ID（含 `..`、斜杠、绝对路径）被拒、读不到/损坏 result 有明确错误。事件只能包含阶段、计数、耗时、用量和脱敏错误摘要；类型不提供正文/Key 字段。
- [x] **Step 3.2：实现存储。** 使用 `atomicWriteFile` 写 JSON/Markdown；trace 先 `mkdir` 后 `appendFile` 并通过 `withPathLock(tracePath)` 串行。创建 `runs/<runId>/briefs` 时逐级 mkdir。写入 JSON 均带换行。
- [x] **Step 3.3：写简报红灯。** 手工构造已验证 card，断言问题、角度、读者价值、来源摘录/归属、限制、待补证据、结构与“传播效果未验证”均出现；不得出现不存在的综合分或模型原始字段。
- [x] **Step 3.4：实现简报并绿灯。** Markdown 使用固定章节，转义来自标题/摘录中可能破坏列表和链接的字符；来源显示本地文章标题、账号和原文 URL，不把 URL 变成自动发布动作。

## Task 4：核心分析编排（TDD）

**Files:** 新建 `src/core/topics/analyze.ts`、`tests/core/topics/analyze.test.ts`；按需修改前述类型。

**Interfaces:**

```ts
interface AnalyzeTopicsDeps {
  libraryRoot: string; model: TopicModel; store: TopicRunStore
  readContent?: TopicSnapshotDeps['readContent']; now?: () => Date; makeRunId?: () => string
}

async function analyzeTopics(
  deps: AnalyzeTopicsDeps,
  input: { window: TopicWindow; articles: readonly ArticleMeta[]; signal?: AbortSignal },
): Promise<TopicRunResult>
```

- [x] **Step 4.1：写成功链路红灯。** 使用具体 FakeTopicModel 返回两阶段 JSON；用真 tmpdir 和真实 store，断言 manifest/result/trace 落盘、最终统计重算、最多三卡、切换/读结果不再次调用模型。断言的是最终文件和结果，不只检查 fake 调用次数。
- [x] **Step 4.2：实现成功编排。** 阶段顺序为 snapshot → manifest → extract → validate-extract → propose → validate-propose → result。每个模型阶段前检查 `signal.aborted`；诊断日志仅记录 runId/阶段/计数/耗时和错误码。
- [x] **Step 4.3：写状态红灯。** 覆盖无有效素材 → `insufficient-material` 且零模型调用；一张卡坏 → `partial`；合法空候选 → `completed` 空数组；顶层错误结构/模型 reject/存储失败 → `failed`；AbortError → `cancelled`。失败不能改写成空候选，也不能覆盖已存在的上一运行目录。
- [x] **Step 4.4：实现状态和可读错误。** 所有返回都带 schemaVersion/runId/window/createdAt/durationMs/model；usage 仅在 fake/未来 provider 提供时保存。结果尽力落盘；manifest 写失败时无法建立运行记录，直接抛存储错误供调用方显示，不能伪装业务结果。
- [x] **Step 4.5：用合成评估材料跑编排契约。** 从 `cases.json` 选同源转载、残缺正文、纯媒体、指令注入四案，构建临时正文并走真实 snapshot/validator/store；fake 响应中的未知引用和平台承诺被拒。测试名称明确这是工程安全/契约验证，不是语义质量通过。

## Task 5：里程碑收尾

- [x] **Step 5.1：针对验证。** `npm test -- tests/core/topics`，记录文件与用例数量。
- [x] **Step 5.2：全量验证。** `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`。lint 既有警告单独报告；不得声称真实模型可用。
- [x] **Step 5.3：状态文档。** ROADMAP 新增 M68，只列快照、校验、存储、简报与注入式模型编排；devlog 记录精确引用存在和事实真实的边界。AI 供应商、Key、CLI/GUI 均写为后续。
- [x] **Step 5.4：审阅与提交。** `git diff --check`、逐项核对 spec §4–9 和本计划；commit message 用临时文件配合 `git commit -F`。按 AGENTS 在功能分支完成后合回 main、删分支，不 push。

## Self-review

- 本计划实现设计 §7 的核心协议和 §8.1 的运行落盘，不实现 Electron 密钥保存、真实 HTTP、CLI/GUI 与四周观察。
- 每个生产函数由先失败的行为测试驱动；人工文档不写源码字符串测试。
- 模型输出采用 unknown + 运行时校验，TypeScript interface 不替代边界校验。
- 文章数、账号数和内容组数来自程序重算；“传播效果未验证”是固定事实状态，不是模型建议。
- 测试 fake 只替代外部模型，文库筛选、快照、校验、统计、存储和简报使用真实实现。
