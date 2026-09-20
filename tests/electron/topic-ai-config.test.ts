import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService } from '../../electron/services/settings'
import { TopicAiConfigError, TopicAiConfigService, type TopicSafeStorage } from '../../electron/services/topic-ai-config'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'wxk-topic-config-')); roots.push(value); return value }

const secure = (available = true): TopicSafeStorage => ({
  isEncryptionAvailable: () => available,
  encryptString: value => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
  decryptString: value => Buffer.from(value.toString().replace(/^encrypted:/, ''), 'base64').toString(),
})

describe('选题 AI 配置', () => {
  it('安全存储可用时 Key 加密独立落盘，settings 与状态均不返回明文', async () => {
    const userData = await root()
    const settings = new SettingsService(userData, '/library')
    const service = new TopicAiConfigService(settings, userData, secure())
    const status = await service.save({ baseUrl: 'https://api.example.invalid/v1', model: 'model-a', apiKey: 'super-secret-key' })
    expect(status).toEqual({ baseUrl: 'https://api.example.invalid/v1', model: 'model-a', keyConfigured: true, keyPersistent: true })
    expect(await service.requireConfig()).toEqual({ baseUrl: 'https://api.example.invalid/v1', model: 'model-a', apiKey: 'super-secret-key' })
    const settingsRaw = await readFile(join(userData, 'settings.json'), 'utf8')
    const keyRaw = await readFile(join(userData, 'topic-ai-key.bin'))
    expect(settingsRaw).not.toContain('super-secret-key')
    expect(settingsRaw).toContain('topicAiBaseUrl')
    expect(keyRaw.toString()).not.toContain('super-secret-key')
    expect((await stat(join(userData, 'topic-ai-key.bin'))).mode & 0o777).toBe(0o600)

    const restarted = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, secure())
    expect(await restarted.requireConfig()).toMatchObject({ apiKey: 'super-secret-key' })
    expect(await restarted.getStatus()).toMatchObject({ keyConfigured: true, keyPersistent: true })
  })

  it('安全存储不可用时 Key 只在当前服务实例有效，重启后诚实丢失', async () => {
    const userData = await root()
    const settings = new SettingsService(userData, '/library')
    const service = new TopicAiConfigService(settings, userData, secure(false))
    expect(await service.save({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'local', apiKey: 'session-key' }))
      .toMatchObject({ keyConfigured: true, keyPersistent: false })
    expect(await service.requireConfig()).toMatchObject({ apiKey: 'session-key' })
    await expect(readFile(join(userData, 'topic-ai-key.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.stringify(await settings.get())).not.toContain('session-key')

    const restarted = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, secure(false))
    expect(await restarted.getStatus()).toMatchObject({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'local', keyConfigured: false, keyPersistent: false })
    await expect(restarted.requireConfig()).rejects.toMatchObject({ code: 'MISSING_AI_API_KEY' })
  })

  it('加密不可用时改用会话 Key，会删除旧密文避免重启后复活旧 Key', async () => {
    const userData = await root()
    const settings = new SettingsService(userData, '/library')
    await new TopicAiConfigService(settings, userData, secure())
      .save({ baseUrl: 'https://a.invalid/v1', model: 'm', apiKey: 'old-key' })

    const session = new TopicAiConfigService(settings, userData, secure(false))
    await session.save({ baseUrl: 'https://a.invalid/v1', model: 'm', apiKey: 'new-session-key' })
    await expect(readFile(join(userData, 'topic-ai-key.bin'))).rejects.toMatchObject({ code: 'ENOENT' })

    const restarted = new TopicAiConfigService(settings, userData, secure())
    expect(await restarted.getStatus()).toMatchObject({ keyConfigured: false, keyPersistent: false })
    await expect(restarted.requireConfig()).rejects.toMatchObject({ code: 'MISSING_AI_API_KEY' })
  })

  it('不提供新 Key 时保留已有 Key，clear 后彻底移除', async () => {
    const userData = await root()
    const service = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, secure())
    await service.save({ baseUrl: 'https://a.invalid/v1', model: 'm1', apiKey: 'persist-me' })
    await service.save({ baseUrl: 'https://b.invalid/v1', model: 'm2' })
    expect(await service.requireConfig()).toEqual({ baseUrl: 'https://b.invalid/v1', model: 'm2', apiKey: 'persist-me' })
    expect(await service.clearKey()).toMatchObject({ keyConfigured: false, keyPersistent: false })
    await expect(service.requireConfig()).rejects.toMatchObject({ code: 'MISSING_AI_API_KEY' })
  })

  it('密文损坏时不伪装为未配置，给出可行动错误', async () => {
    const userData = await root()
    const badStorage: TopicSafeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: () => { throw new Error('decrypt failed') } }
    const service = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, badStorage)
    await service.save({ baseUrl: 'https://a.invalid/v1', model: 'm', apiKey: 'key' })
    await expect(service.requireConfig()).rejects.toMatchObject({ code: 'AI_KEY_UNREADABLE' })
    expect(await service.getStatus()).toMatchObject({ keyConfigured: false, keyPersistent: true })
  })

  it.each([
    { baseUrl: '', model: 'm', apiKey: 'k' },
    { baseUrl: 'https://a.invalid/v1', model: '', apiKey: 'k' },
    { baseUrl: 'https://a.invalid/v1', model: 'm', apiKey: '' },
  ])('拒绝空配置 %#', async input => {
    const userData = await root()
    const service = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, secure())
    await expect(service.save(input)).rejects.toBeInstanceOf(TopicAiConfigError)
  })
})
