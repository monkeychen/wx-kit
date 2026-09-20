# M69 · BYOK 模型适配与 topics CLI 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task, and superpowers:test-driven-development for behavior changes. 在 feature 分支完成、验证、合 main，不 push。

**Goal:** 为 M68 核心接入一种明确的 OpenAI Chat Completions 兼容协议，并交付可用的 `wx-kit topics analyze/brief` CLI。

**Architecture:** 模型传输保持 `TopicModel` 适配层，核心验证器仍是信任边界。CLI 读取本地文库、按 M67 规则筛选后调用 M68 编排；密钥只从环境变量进入进程，不写 settings、stdout、result、trace 或诊断日志。

**Tech Stack:** Node 全局 fetch / AbortSignal、Commander、现有 Electron CLI 分流、Vitest、本地受控 HTTP/注入 fetch 测试；无新依赖。

**Spec:** [本地选题决策器设计](../superpowers/specs/2026-09-20-topic-decisions-design.md)

## Global Constraints

- 协议名称明确为“OpenAI Chat Completions 兼容”，不宣传所有模型供应商均兼容。
- 用户正文会发往所配置地址；CLI help 必须直说。API Key 只读取 `WXKIT_AI_API_KEY`。
- `--base-url` / `WXKIT_AI_BASE_URL` 接受 http/https，允许本地模型；拒绝 URL 凭据、query 和 hash。`--model` / `WXKIT_AI_MODEL` 必填。
- 不接入供应商列表、推荐返佣、托管额度、Key 持久化或 GUI 设置。
- 单请求 90 秒默认超时，不自动重试；外部取消与超时合并。错误与响应摘要落盘前脱敏。
- 模型原始 JSON 仍需经过 M68 校验；模型自报统计和传播判断不进入结果。
- CLI stdout 保持单行纯 JSON；stderr 可输出阶段说明；退出码 0 为完成/部分/材料不足，1 为分析或供应商失败，2 为用法/缺少配置/取消。
- 新命令必须加入 `CLI_COMMANDS`，同步 agent 能力说明和命令参考；README 继续描述已发布 v0.11.3，不把未发布命令写成安装包现状。

---

## Task 1：Chat Completions 兼容适配器（TDD）

**Files:** 新建 `src/core/topics/chat-completions.ts`、`tests/core/topics/chat-completions.test.ts`；修改 `src/core/topics/model.ts`、`src/core/topics/analyze.ts`。

**Interfaces:**

```ts
interface ChatCompletionsConfig { baseUrl: string; model: string; apiKey: string; timeoutMs?: number }
type TopicFetch = (url: string, init: RequestInit) => Promise<Response>
class ChatCompletionsTopicModel implements TopicModel {
  descriptor: { providerId: 'openai-compatible'; modelName: string }
  extract(input: TopicExtractionInput, signal?: AbortSignal): Promise<unknown>
  propose(input: TopicProposalInput, signal?: AbortSignal): Promise<unknown>
  usage(): { inputTokens?: number; outputTokens?: number } | undefined
}
```

- [x] **1.1 红灯：请求契约。** 注入 fetch，断言 URL 为规范化 base + `/chat/completions`（若输入已为该路径则不重复），Authorization/Content-Type、model、temperature、system/user messages 正确；输入正文只在 user content，API Key 不在 body。
- [x] **1.2 实现配置和请求。** URL 只接受 http/https，无用户名密码/query/hash；Key/model 去空白后不能为空。请求不设置供应商特有扩展字段。系统消息含 M68 规则与对应阶段 JSON 字段说明，user 消息为结构化 JSON。
- [x] **1.3 红灯：响应和失败。** 覆盖纯 JSON、单个 `json` code fence、choices 缺失、内容前后夹 prose、HTTP 401、非 JSON HTTP body、AbortError、超时以及一次调用失败不重试。错误正文截 500 字符并 `redactFreeText`。
- [x] **1.4 实现严格解析。** 只接受整个字符串为 JSON object 或单个 fenced JSON object；不从任意 prose 中截取花括号。累加 `usage.prompt_tokens/completion_tokens`，供 analyze 结果保存。
- [x] **1.5 修改模型接口和编排。** `TopicModel.usage?()` 可选；result 在成功、部分或失败时读取一次累计 usage。增加 `onStage?` 回调，阶段为 snapshot/extract/propose/result；回调异常不影响分析。现有 fake 无需实现 usage。

## Task 2：CLI 输入与 topics 命令（TDD）

**Files:** 新建 `src/core/topics/cli-input.ts`、`tests/core/topics/cli-input.test.ts`；修改 `src/cli/index.ts`、`tests/cli/cli-contract.test.ts`。

**Interfaces:**

```ts
function resolveTopicWindowArgs(opts: { range?: string; from?: string; to?: string }, asOfMs?: number): TopicWindow
interface TopicCliModelConfig { baseUrl: string; model: string; apiKey: string }
function resolveTopicCliModelConfig(opts: { baseUrl?: string; model?: string }, env: NodeJS.ProcessEnv): TopicCliModelConfig
```

- [x] **2.1 红灯：纯输入解析。** 默认 24h，支持 3d/7d/custom；custom 必须同时有 from/to，非 custom 不接受 from/to；错误明确。配置参数优先于 env；缺 base/model/key 分别报错；错误不得回显 Key。
- [x] **2.2 实现输入解析。** 复用 `resolveTopicWindow`，不复制时区逻辑。环境变量固定为 `WXKIT_AI_BASE_URL`、`WXKIT_AI_MODEL`、`WXKIT_AI_API_KEY`。
- [x] **2.3 扩展 runCli 注入面。** opts 增加 `env?`、`now?`、`makeTopicRunId?`、`topicModelFactory?`，均有生产默认值。测试注入具体 FakeModel；不 mock Library、时间筛选、分析器、store。
- [x] **2.4 红灯并实现 `topics analyze`。** 参数 `--range 24h|3d|7d|custom --from --to --base-url --model -o/--out`。读取文库全量元数据，先 `selectTopicArticles`，再 `analyzeTopics`。stderr 打印阶段；stdout `{ok,...TopicRunResult,timeExcludedCount}`。result/trace 不含 Key。完成/部分/材料不足为 0，失败 1，取消 2；输入错误 2。
- [x] **2.5 红灯并实现 `topics brief`。** `--run <id> --topic <id> -o/--out` 读取已保存 result，拒绝未找到 topic 或 failed/cancelled 运行；调用 `buildTopicBrief` 和 store 写入，输出 `{ok:true,path,runId,topicId}`，零模型请求。
- [x] **2.6 错误路径。** 无 Key、无模型、无 base、非法 range、自定义日期缺项、超成本和供应商失败均输出单行 JSON，stderr 不泄漏 Key；Commander 用法错误仍退出 2。

## Task 3：CLI 分流和说明书

**Files:** 修改 `electron/cli-dispatch.ts`、`tests/electron/cli-dispatch.test.ts`、`agent/wx-kit-skill/SKILL.md`、`agent/wx-kit-skill/references/commands.md`、`agent/wx-kit-skill/references/recipes.md`、`agent/README.md`、`ROADMAP.md`、devlog。

- [x] **3.1 分流红灯。** `topics` 必须被识别为 CLI；删除白名单项应让测试失败。实现后运行分流测试。
- [x] **3.2 更新说明。** 明确 M69 为当前 main 未发布能力；示例使用环境变量，不出现真实 Key；提醒正文会发送到用户配置服务。记录 `topics brief` 不调用模型。
- [x] **3.3 受控 HTTP 验收。** 测试内启动 127.0.0.1 临时 server，执行适配器两阶段请求，核对两次请求、路径、Authorization 和响应解析；关闭 server 后再运行，确认失败且零重试。它证明协议实现，不代表任意真实供应商兼容。

## Task 4：收尾

- [x] `npm test -- tests/core/topics tests/cli/cli-contract.test.ts tests/electron/cli-dispatch.test.ts`。
- [x] `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`。
- [x] 在没有用户 Key 时，把真实外网模型验收明确记为未执行；不读取机器上的其它密钥猜测配置。
- [x] 更新 ROADMAP M69 和 devlog，审查 stdout/trace/result 不含测试 Key。
- [x] `git diff --check`，英文 commit message 走 `git commit -F`；按 AGENTS 合 main、删分支，不 push。

## Self-review

- 本计划交付第一个真实网络适配和可调用 CLI，不交付 GUI 或安全持久化 Key。
- Key 不走 CLI 参数，不进 settings；环境变量仍会被当前进程读取，用户需自行管理 shell 环境。
- 兼容协议由本地 server 验证结构，真实模型语义与供应商差异仍需后续用用户明确提供的配置验证。
- CLI 的选题结果继续由 M68 运行时验证器决定，adapter 和模型没有绕过校验的第二通道。
