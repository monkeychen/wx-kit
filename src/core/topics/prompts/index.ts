// 发给模型的两阶段任务文本（M76：prompt 升格为契约一等公民）。
//
// 规则：文本由 contract.ts 的常量拼接生成，不手写枚举值。校验器与提示词共用同一份
// 常量，所以「校验器有约束、prompt 没表述」的缺口在构造上就不存在；prompts.test.ts
// 再遍历常量断言一次，防止有人把模板改坏。

import {
  CLAIM_KINDS,
  CONFIDENCE_LEVELS,
  DISTRIBUTION_EVIDENCE_VALUE,
  EVIDENCE_ROLES,
  EXTRACTION_KINDS,
  MAX_CARDS,
  MAX_EXTRACTIONS,
  VALUE_KINDS,
} from './contract'

const orList = (values: readonly string[]): string => values.join('、')

const EXTRACT_INSTRUCTION = `只返回 JSON object，不要输出其它文字、解释或 Markdown 围栏之外的内容：
{"items":[{"id":"x1","groupId":"g001","paragraphId":"g001:p001","quote":"…","kind":"…","summary":"…","theme":"…"}]}
items 可以为空，最多 ${MAX_EXTRACTIONS} 条。逐字段要求：
1. id：字符串，在 items 内唯一（自行编号即可，如 x1、x2）。
2. groupId / paragraphId：必须来自输入 snapshot 里的 groups[].id 与 paragraphs[].id，且该段落的 groupId 必须等于你填的 groupId；不得自行编号、推测或留空。
3. quote：必须是从 paragraphId 对应段落的 text 中逐字复制的连续片段——不改写、不拼接、不加省略号、不翻译、不补标点；只要与原文有一个字符的差异，整条提取就会被丢弃。
4. kind：只能是 ${orList(EXTRACTION_KINDS)} 之一，不得自造值。
5. summary：这一条在讲什么（你的概括，不是原文）。
6. theme：所属主题短语。
7. 除上述六个字段外不要添加其它字段。`

const PROPOSE_INSTRUCTION = `只返回 JSON object，不要输出其它文字、解释或 Markdown 围栏之外的内容：
{"cards":[{"id":"t1","question":"…","angle":"…","rationale":"…","evidence":[{"id":"e1","extractionId":"x1","role":"support"}],"readerValues":[{"kind":"knowledge","benefit":"…","evidenceIds":["e1"]}],"claims":[{"text":"…","kind":"source-fact-claim","evidenceIds":["e1"]}],"evidenceConfidence":{"level":"medium","reasons":["…"]},"limitations":["…"],"missingEvidence":["…"],"outline":["…"]}]}
cards 可以为空，最多 ${MAX_CARDS} 张。逐字段要求：
1. id：字符串，在 cards 内唯一。
2. question / angle / rationale：均为非空字符串。question 是这篇要回答的问题；angle 是切入角度；rationale 是为什么现在值得写。
3. evidence：非空数组，每项只填三个字段——id（卡内唯一）、extractionId、role。extractionId 必须来自本轮输入 extractions 里的 id，不得自造，也不得直接引用段落或文章；role 只能是 ${orList(EVIDENCE_ROLES)} 之一。不要在这里填 quote，摘录由提取项自带。
4. readerValues：非空数组，每项为 {kind, benefit, evidenceIds}。kind 只能是 ${orList(VALUE_KINDS)} 之一，且同一张卡内不得重复同一个 kind；benefit 说明读者具体得到什么；evidenceIds 只能填本卡 evidence 里的 id。
5. claims：非空数组，每项为 {text, kind, evidenceIds}。kind 只能是 ${orList(CLAIM_KINDS)} 之一（依次对应来源陈述、来源观点、编辑推断）；evidenceIds 同样只能引用本卡 evidence 里的 id。
6. evidenceConfidence：{level, reasons}。level 只能是 ${orList(CONFIDENCE_LEVELS)} 之一；reasons 是非空字符串数组，说明为什么是这个等级。
7. limitations：字符串数组，说明这批材料的边界（可以为空数组）。
8. missingEvidence：字符串数组，说明还缺什么证据才能写扎实（可以为空数组）。
9. outline：非空字符串数组，给出可执行的起笔结构。
10. 不要输出 statistics 字段——篇数、账号数等统计由程序计算，一旦提供整张卡判为失败。
11. distributionEvidence 字段只能省略；如果要填，必须且只能填字符串 "${DISTRIBUTION_EVIDENCE_VALUE}"，不得填中文或其它任何值——产品上没有可验证的传播数据。`

/** M76：两阶段任务文本。改契约请改 contract.ts，不要在这里手写取值。 */
export function stageInstruction(stage: 'extract' | 'propose'): string {
  return stage === 'extract' ? EXTRACT_INSTRUCTION : PROPOSE_INSTRUCTION
}
