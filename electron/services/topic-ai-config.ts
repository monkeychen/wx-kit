import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SettingsService } from './settings'

export interface TopicSafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface TopicAiConfigStatus {
  baseUrl: string
  model: string
  keyConfigured: boolean
  keyPersistent: boolean
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
    return {
      baseUrl: settings.topicAiBaseUrl,
      model: settings.topicAiModel,
      keyConfigured: configured,
      keyPersistent: filePresent && this.secureStorage.isEncryptionAvailable(),
    }
  }

  async save(input: { baseUrl: string; model: string; apiKey?: string }): Promise<TopicAiConfigStatus> {
    const baseUrl = validateBaseUrl(input.baseUrl)
    const model = input.model.trim()
    if (!model) throw new TopicAiConfigError('MISSING_AI_MODEL', 'AI model 不能为空。')
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
    await this.settings.save({ topicAiBaseUrl: baseUrl, topicAiModel: model })
    return this.getStatus()
  }

  async clearKey(): Promise<TopicAiConfigStatus> {
    this.sessionKey = null
    await unlink(this.keyPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    return this.getStatus()
  }

  async requireConfig(): Promise<{ baseUrl: string; model: string; apiKey: string }> {
    const settings = await this.settings.get()
    const baseUrl = settings.topicAiBaseUrl.trim()
    const model = settings.topicAiModel.trim()
    if (!baseUrl) throw new TopicAiConfigError('MISSING_AI_BASE_URL', '请先在设置中填写 AI base URL。')
    if (!model) throw new TopicAiConfigError('MISSING_AI_MODEL', '请先在设置中填写 AI model。')
    const apiKey = this.sessionKey ?? await this.persistentKey()
    if (!apiKey) throw new TopicAiConfigError('MISSING_AI_API_KEY', '请先在设置中填写 AI Key。')
    return { baseUrl, model, apiKey }
  }
}
