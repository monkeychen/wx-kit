# M73 — AI 模型设置（厂商选择 · 计费模式 · 推理开关 · 测试连接）

> 原型已确认：`docs/prototypes/ai-model-settings-v2.html`（安哥 2026-09-21 拍板「原型没问题，下一步」）。
> 本里程碑把「选题 AI」三行裸配置升级为多厂商 AI 模型设置。

## 范围

### 1. 厂商目录（core，唯一真相源）

`src/core/topics/providers.ts`：7 厂商 + 自定义，与原型 `PROVIDERS` 常量一一对应。

- 每厂商：`label`、`plans`（payg 必有；zhipu/qwen 另有 plan 订阅端点）、`keyPrefixHint`、`models[]`（id + `reasoning`/`effort` 能力）、`defaultModel`
- custom：baseUrl 空、models 空，端点完全由用户输入
- 目录同时经 IPC 下发给 renderer 供下拉渲染（renderer 不直接 import core 的运行时导出）

### 2. 推理参数下发（chat-completions）

`ChatCompletionsConfig` 增加 `reasoning?: boolean`、`effort?: 'high'|'medium'|'low'`。
映射规则集中在 providers 目录里声明（`reasoningParam`），chat-completions 只负责拼 body：

| 厂商 | reasoning 开/关参数 | effort 参数 |
|---|---|---|
| zhipu | `thinking: {type: 'enabled'\|'disabled'}` | 不下发（GLM 无等级参数） |
| qwen | `enable_thinking: true\|false` | 不下发 |
| openai / gemini | 开启时 `reasoning_effort: <effort>` | `reasoning_effort` |
| deepseek / kimi / minimax / custom | **不下发任何参数**（模型原生行为） | 不下发 |

原则：**文档未证实的行为不下发**。未知厂商宁可保持现状（无参数）也不猜参数格式。
未配置 reasoning（旧调用方）时行为与现在完全一致。

### 3. 测试连接（core + IPC）

`src/core/topics/test-connection.ts`：最小 chat 请求（`max_tokens: 1`，`ping`），测延迟、读 usage。
- 复用 `TopicProviderError` 错误体系（HTTP_xxx / MODEL_TIMEOUT 10s / NETWORK_ERROR）
- **测试的是草稿配置，不是已存配置**：renderer 传 baseUrl+model+可选 apiKey；apiKey 为空时主进程回退已存 Key
- IPC：`topics:testConnection`；连接状态仅存会话内（summary 卡「未测试/可用/异常」），不持久化

### 4. 配置扩展与迁移（electron）

- `AppSettings` 增加：`topicAiProvider`（默认 `''`=未设置）、`topicAiPlan`（默认 `'payg'`）、`topicAiReasoning`（默认 `true`）、`topicAiEffort`（默认 `'high'`）
- `getStatus()` 解析有效厂商：`''` 时按已存 baseUrl 反查目录（payg/plan 两端点都查）；无匹配→`custom`；baseUrl 也空→默认 `zhipu`。只推导不回写，下次保存时落盘
- `save()` 输入改为 `{providerId, plan, baseUrl?, model, apiKey?, reasoning, effort}`：
  - 非 custom：baseUrl 由目录按 provider+plan **派生**（服务端权威，不信任客户端传的 URL）
  - custom：baseUrl 必填，走既有 `validateBaseUrl`
  - plan 校验必须在目录内；model 非空
- `requireConfig()` 返回值增加 `reasoning`/`effort`，`topics-service.modelFactory` 透传给 ChatCompletionsTopicModel

### 5. Renderer 重写（Settings.tsx AI 面板）

对齐原型：
- 厂商 Select / 计费模式 Select（单 plan 时隐藏）/ Base URL 只读 Input（custom 可编辑）/ 模型 AutoComplete（候选来自目录，可自由输入新模型名）/ API Key + 清除 / 推理 Switch / 等级 Select
- 模型能力联动：已知模型按目录显隐推理两行；手输未知模型默认两行都显示
- 测试连接：按钮 + 结果区（成功绿/失败红，两行截断 hover 展开全文，纯 CSS）
- summary 卡：厂商 / 模型 / 连接状态（替换现在的 选题模型/Key/命令行）
- dirty 判断扩展四个新字段；撤销恢复全部草稿
- 「命令行快捷方式」组保持，排 AI 模型之后（原型顺序）

## 非目标

- CLI 参数/env 不变（`WXKIT_AI_*` 仍只认 baseUrl/model/key），`agent/wx-kit-skill` 无需刷新
- 不做厂商账号/OAuth 登录、不做模型列表在线拉取、不持久化连接状态
- 不改选题分析流程本身（snapshot/extract/propose 链路）

## TDD 步骤

1. `tests/core/topics/providers.test.ts` — 目录不变量（每厂商有 payg、URL 合法、defaultModel 在 models 内、effort⇒reasoning）
2. `tests/core/topics/chat-completions.test.ts` 扩展 — reasoning/effort body 映射全表 + 未配置时零变化
3. `tests/core/topics/test-connection.test.ts` — 成功（延迟+usage）/ 401 / 超时 / 非 JSON
4. `tests/electron/topic-ai-config.test.ts` 扩展 — 派生 baseUrl、plan 校验、厂商反查迁移、新字段往返
5. 实现 → `npm test` / `lint` / `tsc --noEmit` 全绿
6. Renderer 手工核对原型对齐（无新 e2e；既有 e2e 回归）

## 风险与已知取舍

- 各厂商 2026 参数格式按当前公开文档整理，集中在 `providers.ts` 一处；错了改一处即可
- 老用户已存 baseUrl 若与目录端点不一致 → 反查落 `custom`，行为不变，无破坏性迁移
