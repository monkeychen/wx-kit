import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SettingsService } from './settings'
import {
  isTopicAiProviderId, resolveProviderBaseUrl, TOPIC_AI_PROVIDER_IDS,
  type TopicAiPlanId, type TopicAiProviderId, type TopicAiReasoningEffort,
} from '../../src/core/topics/providers'

export interface TopicSafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface TopicAiConfigStatus {
  providerId: TopicAiProviderId
  plan: TopicAiPlanId
  baseUrl: string
  model: string
  reasoning: boolean
  effort: TopicAiReasoningEffort
  keyConfigured: boolean
  keyPersistent: boolean
}

export interface TopicAiConfigSaveInput {
  providerId: string
  plan?: TopicAiPlanId
  /** 仅 custom 厂商需要；其余厂商由目录按 provider+plan 派生，传入值一律忽略 */
  baseUrl?: string
  model: string
  apiKey?: string
  reasoning?: boolean
  effort?: TopicAiReasoningEffort
}

export class TopicAiConfigError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'TopicAiConfigError'
  }
}

function validateBaseUrl(value: string): string {
  const trimmed = value.trim()
  let url: URL
  try { url = new URL(trimmed) } catch { throw new TopicAiConfigError('INVALID_AI_BASE_URL', 'AI base URL 不是合法网址。') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TopicAiConfigError('INVALID_AI_BASE_URL', 'AI base URL 只支持 http/https。')
  if (url.username || url.password || url.search || url.hash) throw new TopicAiConfigError('INVALID_AI_BASE_URL', 'AI base URL 不能包含凭据、query 或 hash。')
  return trimmed.replace(/\/+$/, '')
}

const EFFORTS: readonly TopicAiReasoningEffort[] = ['high', 'medium', 'low']

async function exists(path: string): Promise<boolean> {
  try { await readFile(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function writePrivate(path: string, value: Buffer): Promise<void> {
  const temp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  try {
    await writeFile(temp, value, { mode: 0o600 })
    await rename(temp, path)
    await chmod(path, 0o600).catch(() => {})
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

/**
 * 老配置迁移：provider 未落盘时按已存 baseUrl 反查目录端点（payg/plan 都查）。
 * 只推导不回写，下次保存自然落盘。空 baseUrl → 默认智谱；未知端点 → 自定义。
 */
function resolveEffectiveProvider(settings: {
  topicAiProvider: string
  topicAiPlan: 'payg' | 'plan'
  topicAiBaseUrl: string
}): { providerId: TopicAiProviderId; plan: TopicAiPlanId } {
  if (isTopicAiProviderId(settings.topicAiProvider)) {
    return { providerId: settings.topicAiProvider, plan: settings.topicAiPlan === 'plan' ? 'plan' : 'payg' }
  }
  const baseUrl = settings.topicAiBaseUrl.trim()
  if (!baseUrl) return { providerId: 'zhipu', plan: 'payg' }
  for (const id of TOPIC_AI_PROVIDER_IDS) {
    for (const plan of ['payg', 'plan'] as const) {
      if (PROVIDER_BASE_URLS(id, plan) === baseUrl) return { providerId: id, plan }
    }
  }
  return { providerId: 'custom', plan: 'payg' }
}

function PROVIDER_BASE_URLS(id: TopicAiProviderId, plan: TopicAiPlanId): string | null {
  return resolveProviderBaseUrl(id, plan)
}

export class TopicAiConfigService {
  private keyPath: string
  private sessionKey: string | null = null

  constructor(
    private settings: SettingsService,
    userDataDir: string,
    private secureStorage: TopicSafeStorage,
  ) {
    this.keyPath = join(userDataDir, 'topic-ai-key.bin')
  }

  private async persistentKey(): Promise<string | null> {
    if (!this.secureStorage.isEncryptionAvailable() || !(await exists(this.keyPath))) return null
    try {
      const value = this.secureStorage.decryptString(await readFile(this.keyPath)).trim()
      if (!value) throw new Error('empty')
      return value
    } catch {
      throw new TopicAiConfigError('AI_KEY_UNREADABLE', '已保存的 AI Key 无法解密，请清除后重新填写。')
    }
  }

  async getStatus(): Promise<TopicAiConfigStatus> {
    const settings = await this.settings.get()
    const filePresent = await exists(this.keyPath)
    let configured = !!this.sessionKey
    if (!configured && filePresent && this.secureStorage.isEncryptionAvailable()) {
      try { configured = !!(await this.persistentKey()) } catch { configured = false }
    }
    const effective = resolveEffectiveProvider(settings)
    return {
      providerId: effective.providerId,
      plan: effective.plan,
      baseUrl: settings.topicAiBaseUrl,
      model: settings.topicAiModel,
      reasoning: settings.topicAiReasoning,
      effort: settings.topicAiEffort,
      keyConfigured: configured,
      keyPersistent: filePresent && this.secureStorage.isEncryptionAvailable(),
    }
  }

  async save(input: TopicAiConfigSaveInput): Promise<TopicAiConfigStatus> {
    if (!isTopicAiProviderId(input.providerId)) {
      throw new TopicAiConfigError('UNKNOWN_AI_PROVIDER', `不支持的 AI 厂商：${input.providerId}。`)
    }
    if (input.plan !== undefined && input.plan !== 'payg' && input.plan !== 'plan') {
      throw new TopicAiConfigError('INVALID_AI_PLAN', `计费模式无效：${String(input.plan)}。`)
    }
    const plan: TopicAiPlanId = input.plan === 'plan' ? 'plan' : 'payg'
    const reasoning = input.reasoning ?? true
    const effort = EFFORTS.includes(input.effort ?? 'high') ? input.effort ?? 'high' : 'high'
    const model = input.model.trim()
    if (!model) throw new TopicAiConfigError('MISSING_AI_MODEL', 'AI model 不能为空。')

    let baseUrl: string
    if (input.providerId === 'custom') {
      baseUrl = validateBaseUrl(input.baseUrl ?? '')
    } else {
      const derived = resolveProviderBaseUrl(input.providerId, plan)
      if (!derived) throw new TopicAiConfigError('INVALID_AI_PLAN', `厂商 ${input.providerId} 不支持所选计费模式。`)
      baseUrl = derived
    }

    if (input.apiKey !== undefined) {
      const key = input.apiKey.trim()
      if (!key) throw new TopicAiConfigError('MISSING_AI_API_KEY', 'AI Key 不能为空。')
      if (this.secureStorage.isEncryptionAvailable()) {
        await writePrivate(this.keyPath, this.secureStorage.encryptString(key))
        this.sessionKey = null
      } else {
        await unlink(this.keyPath).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        })
        this.sessionKey = key
      }
    }
    await this.settings.save({
      topicAiProvider: input.providerId,
      topicAiPlan: plan,
      topicAiBaseUrl: baseUrl,
      topicAiModel: model,
      topicAiReasoning: reasoning,
      topicAiEffort: effort,
    })
    return this.getStatus()
  }

  async clearKey(): Promise<TopicAiConfigStatus> {
    this.sessionKey = null
    await unlink(this.keyPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    return this.getStatus()
  }

  async requireConfig(): Promise<{
    providerId: TopicAiProviderId
    baseUrl: string
    model: string
    apiKey: string
    reasoning: boolean
    effort: TopicAiReasoningEffort
  }> {
    const settings = await this.settings.get()
    const baseUrl = settings.topicAiBaseUrl.trim()
    const model = settings.topicAiModel.trim()
    if (!baseUrl) throw new TopicAiConfigError('MISSING_AI_BASE_URL', '请先在设置中配置 AI 模型。')
    if (!model) throw new TopicAiConfigError('MISSING_AI_MODEL', '请先在设置中配置 AI 模型。')
    const apiKey = this.sessionKey ?? await this.persistentKey()
    if (!apiKey) throw new TopicAiConfigError('MISSING_AI_API_KEY', '请先在设置中配置 AI 模型与 API Key。')
    const effective = resolveEffectiveProvider(settings)
    return {
      providerId: effective.providerId,
      baseUrl,
      model,
      apiKey,
      reasoning: settings.topicAiReasoning,
      effort: settings.topicAiEffort,
    }
  }
}
