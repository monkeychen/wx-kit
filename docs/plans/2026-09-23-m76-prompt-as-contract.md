# M76 · 把提示词升格为契约一等公民

日期：2026-09-23
触发：真实供应商第二次跑通到 propose 阶段，三张卡全灭于 `INVALID_DISTRIBUTION_EVIDENCE`。
与 M74（`INVALID_EXTRACTION_KIND` / `QUOTE_NOT_FOUND`）是**同一个病根第二次发作**。

## 1. 病根

`stageInstruction()` 只列字段名，不写取值约束。校验器（validate.ts）里每条硬约束
在 prompt 里没有对应表述时，模型只能猜；猜错即整批失败。

| 校验器约束 | M74 前 prompt | 现状 |
|---|---|---|
| `kind ∈ 六值枚举` | 未提 | 已修 |
| `quote` 逐字连续子串 | 未提 | 已修 |
| `readerValues[].kind ∈ 五值` | 未提 | **缺口** |
| `claims[].kind ∈ 三值` | 未提 | **缺口** |
| `evidence[].role ∈ 三值` | 未提 | **缺口** |
| `evidenceConfidence.level ∈ 三值` | 未提 | **缺口** |
| `distributionEvidence` 只能省略或 `"unverified"` | 未提 | **缺口（本次报错）** |
| 禁止 `statistics` | 已提 | 已提 |
| `evidence[].extractionId` 必须来自输入 | 未提 | **缺口** |

fixture 桩测永远吐合法值 → 契约缺口在 990 个单测下全程隐形，只在真供应商第一次调用时暴露。

## 2. 目标

**让「校验器有约束但 prompt 没表述」这类缺口在 CI 就红，而不是等真钱调 API。**

非目标：
- 不改两阶段架构（extract/propose 隔离幻觉的设计不变）
- 不改卡片 schema 本身（不加字段、不改枚举值）
- 不做 prompt 自动重写/重试

## 3. 设计

### 3.1 单一真相源（消除手写副本）

新建 `src/core/topics/prompts/contract.ts`，导出全部约束常量：

```
EXTRACTION_KINDS, VALUE_KINDS, CLAIM_KINDS, EVIDENCE_ROLES, CONFIDENCE_LEVELS,
DISTRIBUTION_EVIDENCE_VALUE = 'unverified',
MAX_EXTRACTIONS = 200, MAX_CARDS = 3
```

`validate.ts` 删除自己的私有 Set，改为 import 同一份常量。
**prompt 文本由这些常量拼接生成**——已声明的约束不可能漏进文本。

### 3.2 目录

`src/core/topics/prompts/`
- `contract.ts` 约束常量（validate 与 prompt 共用）
- `index.ts` `stageInstruction(stage)` 生成两条指令

落实设计文档（2026-09-20 topic-decisions-design）里「可审阅、可版本化的任务文本」的要求；
M68 实现时把 prompt 塞进了 `chat-completions.ts`，这是它容易被忽略、与校验器不同步的结构性原因。

### 3.3 契约全文（propose 阶段新增内容）

- 顶层：`cards` 数组，可为空，最多 3 张
- 卡内必填：`id`（卡内唯一）、`question`、`angle`、`rationale`、`evidence`、`readerValues`、
  `claims`、`evidenceConfidence`、`limitations`、`missingEvidence`、`outline`
- **禁止**出现 `statistics`（由程序重算）
- `distributionEvidence`：只能省略，或填字面量 `"unverified"`（不得写中文、不得写其它值）
- `evidence[]`：`{id, extractionId, role}`，`extractionId` 必须来自本轮输入的提取项 id；
  `role` 三值；`id` 卡内唯一；不得自带 quote（摘录由提取项带入）
- `readerValues[]`：`{kind, benefit, evidenceIds}`，kind 五值且卡内不重复；
  `evidenceIds` 只能引用本卡 `evidence[].id`
- `claims[]`：`{text, kind, evidenceIds}`，kind 三值，引用规则同上
- `evidenceConfidence`：`{level, reasons}`，level 三值，reasons 为非空字符串数组
- `outline` 非空字符串数组；`limitations` / `missingEvidence` 字符串数组（可为空）

extract 阶段补齐：`quote` 逐字连续子串定义、`groupId`/`paragraphId` 必须来自 snapshot 且
段落属于该组、`id` 唯一、最多 200 条。

### 3.4 测试（红灯先行）

`tests/core/topics/prompts.test.ts`：
1. extract 指令包含六个 kind 值、逐字要求、ID 来源要求
2. propose 指令包含：五值 readerValue kind、三值 claim kind、三值 evidence role、
   三值 confidence level、`"unverified"`、禁止 statistics、引用必须来自输入 ID、最多三张
3. **每个枚举值和护栏值都由常量遍历断言**——以后新增枚举值而 prompt 模板漏改，测试即红
4. 两条指令都不为空且不含未闭合占位

## 4. 步骤

1. 写 `tests/core/topics/prompts.test.ts`（红灯）
2. 建 `prompts/contract.ts` + `prompts/index.ts`，由常量生成指令
3. `validate.ts` 改为 import 常量（删私有副本）
4. `chat-completions.ts` 的 `stageInstruction` 改为从 `prompts/` 引入
5. validate 失败 trace 打印实际收到的值（便于真机排查下一次缺口）
6. `npm test` / `npx tsc --noEmit` / `npm run lint` / `npm run test:e2e`
7. 合回 main，同步 devlog §76

## 5. 验收

- 990+ 单测全绿，新增 prompts 测试覆盖全部枚举与护栏
- 真实供应商 propose 阶段不再出现 `INVALID_DISTRIBUTION_EVIDENCE`
- 契约改动只需改 `contract.ts` 一处，prompt 与校验器同步生效
