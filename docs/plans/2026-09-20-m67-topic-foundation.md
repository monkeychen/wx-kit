# M67 · 选题基础契约与 compose 退场实现计划

> **目标版本：v0.12.0（未发布）。产品与验收契约：[`docs/PRD-v0.12.0.md`](../PRD-v0.12.0.md)。**

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task, with superpowers:test-driven-development for runtime behavior. 按本仓库 AGENTS 在当前目录的 feature 分支执行；各任务顺序完成，评审后自动合回 main，不推送。

**Goal:** 完成旧 compose 的安全退场，并交付可执行的发表时间筛选规则、选题结果类型和十二类可复用语义评估材料。

**Architecture:** 新增纯逻辑 `src/core/topics/`，复用现有发表时间解析；不接网络、不改现有文库/导出语义。结果类型用于约束后续分析器，评估素材独立于用户真实文库。

**Tech Stack:** TypeScript、现有 Vitest、JSON、Node 文件系统测试读取。

**Spec:** [v0.12.0 PRD](../PRD-v0.12.0.md) · [本地选题决策器设计](../superpowers/specs/2026-09-20-topic-decisions-design.md)

## Global Constraints

- 初始默认最近 24 小时；可手选最近 3 天、7 天或自定义日期。
- 使用 `parsePublicationTime` 解释原文时间，并保留原始字符串。下载时间、文件修改时间、订阅检查时间不能代替发表时间。
- 自定义起止日期按北京时间自然日处理，包含用户选择的结束日期；内部归一为 `[开始日零点, 结束日次日零点)`。
- 当前里程碑不实现 AI 调用、选题页、CLI topics 入口、收费与运营数据采集。
- 不改旧 `library export --since` 按下载日期筛选的行为；不读或写用户真实文库。
- 历史 PRD、计划、发版说明和复盘保留；仅清理当前 compose 入口。
- 本期不增加依赖或修改根包版本。新目录下文件 kebab-case；核心层不导入 Electron/React。

## 文件结构约定

| 文件 | 责任 |
| --- | --- |
| `src/core/topics/types.ts` | 时间、证据、选题卡和运行结果的公共类型 |
| `src/core/topics/time-window.ts` | 冻结输入范围，解释时间精度，纯函数筛选元数据 |
| `tests/core/topics/time-window.test.ts` | 真实日期边界、错误输入、时区与原文时间筛选 |
| `tests/core/topics/eval-cases.test.ts` | 用评估集的固定时间样本验证筛选结果 |
| `tests/fixtures/topic-decisions/cases.json` | 十二类完全合成材料与人工评估约束 |
| `tests/fixtures/topic-decisions/README.md` | 数据结构、用途、复跑办法与能力边界 |
| `tests/fixtures/topic-decisions/review-template.json` | 后续真实模型的人工评审记录模板 |

`cases.json` 是长期保留的测试输入；真实模型输出与报告写入已忽略的 `output/topic-decisions-evals/<runId>/`，不提交用户内容。新目录不接受临时下载文件或 API Key。

## Task 1：规范前置与 compose 退场

**Files:** 修改 `AGENTS.md`、`agent/README.md`、`agent/wx-kit-skill/SKILL.md`；删除 `agent/wx-kit-compose/SKILL.md`。

**Interfaces:** 现有 CLI 和导出接口不变。自然语言写作路由不再指向已删除目录。

- [x] 在 AGENTS 记录选题边界与新 core/eval 目录规则。当前阶段可开发选题决策，不能把它写成已上线。
- [x] 删除 compose 文件；清理 agent README 的目录条目、安装步骤、委派写作与 compose 专属说明。继续保留供料契约与站点同步说明。
- [x] 将能力 Skill 的排除项改成“文章创作与选题决策（不属于本 Skill 的已上线 CLI 能力）”，不引导到未实现的替代 Skill。
- [x] 检查 `rg -n 'wx-kit-compose' AGENTS.md agent` 的剩余命中，允许明确的退场说明，禁止仍可安装/调用的入口。历史目录不清理。此为人工文档核对，不写源码字符串断言测试。

## Task 2：时间范围规则与类型（TDD）

**Files:** 新建 `src/core/topics/types.ts`、`src/core/topics/time-window.ts`、`tests/core/topics/time-window.test.ts`。

**Consumes:** `ArticleMeta`、`parsePublicationTime(value)`、`shanghaiDate(instant)`。

**Produces:**

```ts
type TopicWindowInput =
  | { preset: '24h' | '3d' | '7d' }
  | { preset: 'custom'; from: string; to: string }

interface TopicWindow {
  preset: TopicWindowInput['preset']
  fromMs: number
  toMs: number
  asOfMs: number
  timeZone: 'Asia/Shanghai'
}

type TopicTimeExclusion = 'unknown-publication-time' | 'outside-window'
  | 'future-publication-time' | 'uncertain-publication-time'

type TopicPublicationDecision =
  | { included: true; precision: 'instant' | 'day'; publishedAtMs: number }
  | { included: false; reason: TopicTimeExclusion }

function resolveTopicWindow(input?: TopicWindowInput, asOfMs?: number): TopicWindow
function classifyTopicPublication(publishTime: string, window: TopicWindow): TopicPublicationDecision
function selectTopicArticles(articles: readonly ArticleMeta[], window: TopicWindow): {
  articles: ArticleMeta[]
  excluded: Array<{ id: string; publishTime: string; reason: TopicTimeExclusion }>
}
```

- [x] 先写测试并运行 `npm test -- tests/core/topics/time-window.test.ts`，记录因为能力尚未实现而失败。

固定时钟为 `2026-09-20T04:00:00Z`（北京时间中午）。必须用手算的字面量作预期，不能调用被测 helper 构造预期。

```ts
const asOfMs = Date.parse('2026-09-20T04:00:00Z')
it('默认按点击时刻冻结过去 24 小时', () => {
  expect(resolveTopicWindow(undefined, asOfMs)).toEqual({
    preset: '24h', fromMs: Date.parse('2026-09-19T04:00:00Z'),
    toMs: asOfMs, asOfMs, timeZone: 'Asia/Shanghai',
  })
})
it('自定义包含结束日且使用北京时间', () => {
  expect(resolveTopicWindow({ preset: 'custom', from: '2026-09-18', to: '2026-09-19' }, asOfMs))
    .toMatchObject({ fromMs: Date.parse('2026-09-17T16:00:00Z'), toMs: Date.parse('2026-09-19T16:00:00Z') })
})
it('只给日期不能被当成昨天零点进入滚动范围', () => {
  expect(classifyTopicPublication('2026-09-19', resolveTopicWindow(undefined, asOfMs)))
    .toEqual({ included: false, reason: 'uncertain-publication-time' })
})
```

还需覆盖：3/7 天窗口；起点包含、终点排除；非法日期/顺序/时钟/运行时 preset；同一天不同 UTC 偏移；未来发表；空日期；日期仅有空格；完整覆盖的日期精度文章可入选；旧文今天下载仍不入选；今天发表但无订阅仍入选；输入数组不被改写。

- [x] 新增类型与最小实现，按以下已定逻辑编写，不引入网络或 fs。

```ts
const DAY_MS = 86_400_000
const HOURS = { '24h': 24, '3d': 72, '7d': 168 } as const
// resolve: 校验 asOf 可表示为有效 Date；preset 必须是上面的四种。
// custom: 严格 YYYY-MM-DD 且 parsePublicationTime 非空；from <= to；结束加一天。
// relative: fromMs = asOfMs - HOURS[preset] * 3_600_000；toMs = asOfMs。
// classify: 原始时间为空/不合法 → unknown；精确时刻晚于 asOf → future。
// 精确时间采用 fromMs <= instant && instant < toMs。
// 日期精度采用 [dayStart, dayStart + DAY_MS)；先判相交，再判是否完整被窗口包含。
// 日期精度与窗口部分相交 → uncertain；不得把日期默认为精确零点。
// select: 遍历只读数组，每条都由 classify 决定，保留原 ArticleMeta，另收排除理由。
```

- [x] 在 `types.ts` 声明证据与结果：文章/段落 ID、精确摘录、支持/反对/背景角色；读者价值与来源 ID；候选问题/角度/限制/结构；`evidenceConfidence` 必带理由；`distributionEvidence` 仅可为 `unverified`；运行状态覆盖完成、材料不足、部分完成、取消和失败。此处声明未来消费者的契约，不宣称已有运行时 schema 校验器。
- [x] 重跑针对测试，补齐合理的边界失败；再运行类型检查。

## Task 3：可复用评估材料与筛选回归

**Files:** 新建上述三个 fixture 文件和 `tests/core/topics/eval-cases.test.ts`。

**Consumes:** `resolveTopicWindow`、`selectTopicArticles`。

**Produces:** 固定输入与人工语义评分口径，后续分析器直接复用；本阶段只运行时间筛选测试。

- [x] 先写读取 fixture 并调用真实筛选函数的测试；预期 ID 来自 fixture 的独立人工标注。

```ts
const suite = JSON.parse(readFileSync('tests/fixtures/topic-decisions/cases.json', 'utf8'))
for (const c of suite.cases) {
  it(c.name, () => {
    const window = resolveTopicWindow(c.window, Date.parse(c.asOf))
    const result = selectTopicArticles(c.materials.map((m: { article: ArticleMeta }) => m.article), window)
    expect(result.articles.map((m) => m.id)).toEqual(c.expected.includedIds)
    expect(result.excluded.map((m) => ({ id: m.id, reason: m.reason }))).toEqual(c.expected.excluded)
  })
}
```

- [x] 添加十二类 `cases.json`，全部使用 `example.invalid` 地址和合成作者，不含真实用户资料：多角度材料、单来源事实、同源转载、旧事新发、观点冲突、证据不足、正文残缺、纯媒体、同名不同文、日期边界、历史反馈重复、材料内指令注入。

每个 case 的必要结构如下，`materials[].article` 必须是完整 ArticleMeta，正文独立放在 `content`。同源转载显式保存合成正文相同的材料；语义预期不要只写“结果正确”，而要具体写禁止推断与有用的提问方向。

```json
{
  "id": "single-source",
  "name": "单一原始公告可以支持窄题目",
  "asOf": "2026-09-20T04:00:00Z",
  "window": { "preset": "24h" },
  "expected": { "includedIds": ["notice-1"], "excluded": [] },
  "semanticChecks": [
    "允许从公告提出一个具体问题，不因只有一个来源就判零价值",
    "不能声称多来源验证或全网关注"
  ]
}
```

- [x] README 写清“时间测试已执行不等于语义评估通过”，记录 rubric：角度具体性、读者价值、来源支持、限制/反方、可下笔程度，各 0–2 分；虚构证据和承诺推流为直接失败。总分只供内部比较，不成为用户可见爆款分。
- [x] `review-template.json` 包含模型/提示词版本、case ID、运行 ID、人工评分与理由、硬失败、采用/发布反馈、耗时与用量。各项初值为 `null`/未评估，不伪造结果。
- [x] 运行 `npm test -- tests/core/topics`，断言时间口径在所有素材集一致。

## Task 4：收尾与交付

- [x] 检查变更只涉及计划列出的文件和必要状态文档；旧历史保持不变。
- [x] `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`，记录新测试总数和已有警告。
- [x] 更新 ROADMAP：M67 已完成的仅是基础契约与退场；AI、GUI、真实语义验收仍未实现。增补 devlog 方法和实际验证结果。
- [x] 审阅完整 diff；英文 commit message 用独立文件 `git commit -F <文件>`。按 AGENTS 合回 main、删除 feature 分支；不 push。

## 自审

本计划仅覆盖设计 §12 的 A 步骤。网络传输、模型输出校验器、可观测运行记录、GUI/CLI topics 和四周观察分别属于 B/C/D；没有把它们标成完成。文档删除不写假测试，类型不写自证式断言；真实行为测试集中在新时间规则及其固定样例。
