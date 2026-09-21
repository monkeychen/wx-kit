// 厂商目录：AI 模型设置的唯一真相源（M73）。
// GUI 下拉、baseUrl 派生、推理参数映射都从这里走；CLI 不经过本文件（保持 baseUrl/model/key 裸配置）。
// 参数映射原则：文档未证实的参数不下发——宁可保持模型原生行为，也不猜请求体格式。

export type TopicAiPlanId = 'payg' | 'plan'
export type TopicAiReasoningEffort = 'high' | 'medium' | 'low'

/** 推理参数的厂商约定。null = 不下发任何推理参数（模型原生行为）。 */
type ReasoningParamStyle = 'zhipu-thinking' | 'qwen-enable-thinking' | 'openai-reasoning-effort' | null

export interface ProviderModelSpec {
  id: string
  /** 是否支持推理（思考）模式 */
  reasoning: boolean
  /** 是否支持推理等级（以 reasoning 为前提） */
  effort: boolean
}

export interface ProviderPlanSpec {
  label: string
  baseUrl: string
}

export interface ProviderSpec {
  label: string
  /** Key 创建入口提示（计费模式选错端点会 401，这里是排障第一线索） */
  keyPrefixHint: string
  plans: Partial<Record<TopicAiPlanId, ProviderPlanSpec>> & { payg: ProviderPlanSpec }
  models: ProviderModelSpec[]
  defaultModel: string
  reasoningParam: ReasoningParamStyle
  /** 是否通过 reasoning_effort 下发等级（仅 openai 风格） */
  effortParam: boolean
}

export const PROVIDER_CATALOG: Record<TopicAiProviderId, ProviderSpec> = {
  zhipu: {
    label: '智谱',
    keyPrefixHint: 'Coding Plan 的 Key 在 plan.bigmodel.cn 「API Keys」页创建；按量 Key 在开放平台创建。',
    plans: {
      payg: { label: '按量付费', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
      plan: { label: '订阅付费', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4' },
    },
    models: [
      { id: 'glm-5.3-flash', reasoning: true, effort: true },
      { id: 'glm-5.3', reasoning: true, effort: true },
      { id: 'glm-5.3-flashx', reasoning: true, effort: true },
    ],
    defaultModel: 'glm-5.3-flash',
    reasoningParam: 'zhipu-thinking',
    effortParam: false,
  },
  qwen: {
    label: '千问',
    keyPrefixHint: '按量 Key 以 sk- 开头；Token Plan Key 以 sk-sp- 开头，选错端点会 401。',
    plans: {
      payg: { label: '按量付费', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      plan: { label: '订阅付费', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' },
    },
    models: [
      { id: 'qwen3.8-flash', reasoning: true, effort: true },
      { id: 'qwen3.8-max', reasoning: true, effort: true },
      { id: 'qwen3.7-plus', reasoning: true, effort: true },
    ],
    defaultModel: 'qwen3.8-flash',
    reasoningParam: 'qwen-enable-thinking',
    effortParam: false,
  },
  deepseek: {
    label: 'DeepSeek',
    keyPrefixHint: '旧 deepseek-chat / deepseek-reasoner 已于 2026-07 下线，请使用新模型名。',
    plans: { payg: { label: '按量付费', baseUrl: 'https://api.deepseek.com/v1' } },
    models: [
      { id: 'deepseek-flash', reasoning: true, effort: true },
      { id: 'deepseek-v4-pro', reasoning: true, effort: true },
    ],
    defaultModel: 'deepseek-flash',
    reasoningParam: null,
    effortParam: false,
  },
  kimi: {
    label: 'Kimi',
    keyPrefixHint: '旧 moonshot-v1 系列与 kimi-latest 已下线，请使用 kimi-k3。',
    plans: { payg: { label: '按量付费', baseUrl: 'https://api.moonshot.cn/v1' } },
    models: [
      { id: 'kimi-k3', reasoning: true, effort: true },
      { id: 'kimi-k2.7-code', reasoning: true, effort: false },
    ],
    defaultModel: 'kimi-k3',
    reasoningParam: null,
    effortParam: false,
  },
  minimax: {
    label: 'MiniMax',
    keyPrefixHint: '在 MiniMax 开放平台「API Key」页创建。',
    plans: { payg: { label: '按量付费', baseUrl: 'https://api.minimax.chat/v1' } },
    models: [
      { id: 'MiniMax-M3', reasoning: true, effort: false },
      { id: 'MiniMax-M2.7-highspeed', reasoning: true, effort: false },
    ],
    defaultModel: 'MiniMax-M3',
    reasoningParam: null,
    effortParam: false,
  },
  openai: {
    label: 'OpenAI',
    keyPrefixHint: 'Key 以 sk- 开头。',
    plans: { payg: { label: '按量付费', baseUrl: 'https://api.openai.com/v1' } },
    models: [
      { id: 'gpt-5.6-sol', reasoning: true, effort: true },
      { id: 'gpt-4o', reasoning: false, effort: false },
      { id: 'o3-mini', reasoning: true, effort: true },
      { id: 'o1', reasoning: true, effort: true },
    ],
    defaultModel: 'gpt-5.6-sol',
    reasoningParam: 'openai-reasoning-effort',
    effortParam: true,
  },
  gemini: {
    label: 'Google',
    keyPrefixHint: 'AI Studio Key 以 AIza 开头。',
    plans: { payg: { label: '按量付费', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' } },
    models: [
      { id: 'gemini-3.8-flash', reasoning: true, effort: true },
      { id: 'gemini-3.1-pro', reasoning: true, effort: true },
      { id: 'gemini-2.5-flash', reasoning: true, effort: true },
    ],
    defaultModel: 'gemini-3.8-flash',
    reasoningParam: 'openai-reasoning-effort',
    effortParam: true,
  },
  custom: {
    label: '自定义',
    keyPrefixHint: '任何 OpenAI Chat Completions 兼容服务。',
    plans: { payg: { label: '按量付费', baseUrl: '' } },
    models: [],
    defaultModel: '',
    reasoningParam: null,
    effortParam: false,
  },
}

export type TopicAiProviderId =
  | 'zhipu' | 'qwen' | 'deepseek' | 'kimi' | 'minimax' | 'openai' | 'gemini' | 'custom'

export const TOPIC_AI_PROVIDER_IDS = Object.keys(PROVIDER_CATALOG) as TopicAiProviderId[]

export function isTopicAiProviderId(value: string): value is TopicAiProviderId {
  return Object.hasOwn(PROVIDER_CATALOG, value)
}

/** 按厂商 + 计费模式取端点；plan 不存在视为无效配置。 */
export function resolveProviderBaseUrl(providerId: TopicAiProviderId, plan: TopicAiPlanId): string | null {
  return PROVIDER_CATALOG[providerId].plans[plan]?.baseUrl ?? null
}

/** 查模型能力；未知模型（手输/自定义）返回 undefined，由调用方决定默认显隐。 */
export function resolveProviderModel(providerId: TopicAiProviderId, modelId: string): ProviderModelSpec | undefined {
  return PROVIDER_CATALOG[providerId].models.find(model => model.id === modelId.trim())
}

/**
 * 推理参数映射。reasoning 为 undefined 时不产出任何字段（CLI/旧调用方零变化）。
 * 关闭推理时只对有显式开关参数的厂商下发关闭；OpenAI 风格无法用参数关闭，省略。
 */
export function reasoningBodyFields(
  providerId: TopicAiProviderId,
  input: { reasoning?: boolean; effort?: TopicAiReasoningEffort },
): Record<string, unknown> {
  if (input.reasoning === undefined) return {}
  const spec = PROVIDER_CATALOG[providerId]
  const effort = input.effort ?? 'high'
  switch (spec.reasoningParam) {
    case 'zhipu-thinking':
      return { thinking: { type: input.reasoning ? 'enabled' : 'disabled' } }
    case 'qwen-enable-thinking':
      return { enable_thinking: input.reasoning }
    case 'openai-reasoning-effort':
      return input.reasoning && spec.effortParam ? { reasoning_effort: effort } : {}
    default:
      return {}
  }
}
