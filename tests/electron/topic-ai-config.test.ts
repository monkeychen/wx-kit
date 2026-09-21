import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
    const status = await service.save({ providerId: 'custom', baseUrl: 'https://api.example.invalid/v1', model: 'model-a', apiKey: 'super-secret-key' })
    expect(status).toMatchObject({ providerId: 'custom', baseUrl: 'https://api.example.invalid/v1', model: 'model-a', keyConfigured: true, keyPersistent: true })
    expect(await service.requireConfig()).toEqual({ providerId: 'custom', baseUrl: 'https://api.example.invalid/v1', model: 'model-a', apiKey: 'super-secret-key', reasoning: true, effort: 'high' })
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
    expect(await service.save({ providerId: 'custom', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local', apiKey: 'session-key' }))
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
      .save({ providerId: 'custom', baseUrl: 'https://a.invalid/v1', model: 'm', apiKey: 'old-key' })

    const session = new TopicAiConfigService(settings, userData, secure(false))
    await session.save({ providerId: 'custom', baseUrl: 'https://a.invalid/v1', model: 'm', apiKey: 'new-session-key' })
    await expect(readFile(join(userData, 'topic-ai-key.bin'))).rejects.toMatchObject({ code: 'ENOENT' })

    const restarted = new TopicAiConfigService(settings, userData, secure())
    expect(await restarted.getStatus()).toMatchObject({ keyConfigured: false, keyPersistent: false })
    await expect(restarted.requireConfig()).rejects.toMatchObject({ code: 'MISSING_AI_API_KEY' })
  })

  it('不提供新 Key 时保留已有 Key，clear 后彻底移除', async () => {
    const userData = await root()
    const service = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, secure())
    await service.save({ providerId: 'custom', baseUrl: 'https://a.invalid/v1', model: 'm1', apiKey: 'persist-me' })
    await service.save({ providerId: 'custom', baseUrl: 'https://b.invalid/v1', model: 'm2' })
    expect(await service.requireConfig()).toEqual({ providerId: 'custom', baseUrl: 'https://b.invalid/v1', model: 'm2', apiKey: 'persist-me', reasoning: true, effort: 'high' })
    expect(await service.clearKey()).toMatchObject({ keyConfigured: false, keyPersistent: false })
    await expect(service.requireConfig()).rejects.toMatchObject({ code: 'MISSING_AI_API_KEY' })
  })

  it('密文损坏时不伪装为未配置，给出可行动错误', async () => {
    const userData = await root()
    const badStorage: TopicSafeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: () => { throw new Error('decrypt failed') } }
    const service = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, badStorage)
    await service.save({ providerId: 'custom', baseUrl: 'https://a.invalid/v1', model: 'm', apiKey: 'key' })
    await expect(service.requireConfig()).rejects.toMatchObject({ code: 'AI_KEY_UNREADABLE' })
    expect(await service.getStatus()).toMatchObject({ keyConfigured: false, keyPersistent: true })
  })

  it.each([
    { providerId: 'custom', baseUrl: '', model: 'm', apiKey: 'k' },
    { providerId: 'custom', baseUrl: 'https://a.invalid/v1', model: '', apiKey: 'k' },
    { providerId: 'custom', baseUrl: 'https://a.invalid/v1', model: 'm', apiKey: '' },
    { providerId: 'unknown-vendor', baseUrl: '', model: 'm', apiKey: 'k' },
    { providerId: 'zhipu', plan: 'monthly', baseUrl: '', model: 'm', apiKey: 'k' },
  ])('拒绝无效配置 %#', async input => {
    const userData = await root()
    const service = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, secure())
    await expect(service.save(input as never)).rejects.toBeInstanceOf(TopicAiConfigError)
  })

  it('已知厂商的 baseUrl 由目录派生，不信任客户端传入值', async () => {
    const userData = await root()
    const service = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, secure())
    const status = await service.save({ providerId: 'zhipu', plan: 'payg', baseUrl: 'https://evil.invalid/override', model: 'glm-5.3-flash', apiKey: 'k' })
    expect(status.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(status.providerId).toBe('zhipu')
    const planStatus = await service.save({ providerId: 'zhipu', plan: 'plan', model: 'glm-5.3-flash' })
    expect(planStatus.baseUrl).toBe('https://open.bigmodel.cn/api/coding/paas/v4')
  })

  it('厂商不存在该计费模式时报错（deepseek 无订阅端点）', async () => {
    const userData = await root()
    const service = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, secure())
    await expect(service.save({ providerId: 'deepseek', plan: 'plan', model: 'deepseek-flash', apiKey: 'k' }))
      .rejects.toMatchObject({ code: 'INVALID_AI_PLAN' })
  })

  it('推理偏好随保存往返，requireConfig 透传给模型层', async () => {
    const userData = await root()
    const service = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, secure())
    await service.save({ providerId: 'zhipu', plan: 'payg', model: 'glm-5.3-flash', apiKey: 'k', reasoning: false })
    const status = await service.getStatus()
    expect(status).toMatchObject({ providerId: 'zhipu', plan: 'payg', reasoning: false, effort: 'high' })
    await service.save({ providerId: 'openai', model: 'o3-mini', reasoning: true, effort: 'medium' })
    expect(await service.requireConfig()).toMatchObject({ providerId: 'openai', reasoning: true, effort: 'medium' })
    await service.save({ providerId: 'openai', model: 'o3-mini', reasoning: true, effort: 'max' })
    expect(await service.requireConfig()).toMatchObject({ effort: 'max' })
    await service.save({ providerId: 'openai', model: 'o3-mini', reasoning: true, effort: 'ultra' as never })
    expect(await service.requireConfig()).toMatchObject({ effort: 'high' })
  })

  it('老配置迁移：settings 只有 baseUrl 时按目录反查厂商；未知端点归自定义；空端点归默认智谱', async () => {
    const userData = await root()
    const seed = {
      topicAiBaseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      topicAiModel: 'qwen3.8-flash',
    }
    await writeFile(join(userData, 'settings.json'), JSON.stringify(seed), 'utf8')
    const service = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, secure())
    expect(await service.getStatus()).toMatchObject({ providerId: 'qwen', plan: 'plan', model: 'qwen3.8-flash' })

    await writeFile(join(userData, 'settings.json'), JSON.stringify({ topicAiBaseUrl: 'https://self-host.invalid/v1', topicAiModel: 'llama' }), 'utf8')
    const custom = new TopicAiConfigService(new SettingsService(userData, '/library'), userData, secure())
    expect(await custom.getStatus()).toMatchObject({ providerId: 'custom', plan: 'payg', baseUrl: 'https://self-host.invalid/v1' })

    const fresh = new TopicAiConfigService(new SettingsService(await root(), '/library'), await root(), secure())
    expect(await fresh.getStatus()).toMatchObject({ providerId: 'zhipu', plan: 'payg' })
  })
})
