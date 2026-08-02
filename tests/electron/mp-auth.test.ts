import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/unused') },
  BrowserWindow: class {},
  session: { fromPartition: vi.fn() },
}))

import { clearMpAuthState, MpAuthClearError, startFreshLogin } from '../../electron/services/mp-auth'

function fakePartition(overrides: Partial<{
  closeAllConnections: () => Promise<void>
  clearStorageData: () => Promise<void>
  clearCache: () => Promise<void>
  clearAuthCache: () => Promise<void>
}> = {}) {
  return {
    closeAllConnections: vi.fn(async () => {}),
    clearStorageData: vi.fn(async () => {}),
    clearCache: vi.fn(async () => {}),
    clearAuthCache: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('公众号登录态清理', () => {
  let dir: string

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wxk-auth-clear-')) })

  it('只删除 session 文件，并清空整个专用分区、缓存、认证缓存与连接', async () => {
    const sessionFile = join(dir, 'mp-session.json')
    const settingsFile = join(dir, 'settings.json')
    const requestStateFile = join(dir, 'mp-request-state.json')
    writeFileSync(sessionFile, '{"token":"old"}')
    writeFileSync(settingsFile, '{"subscriptionCheckTime":"22:03"}')
    writeFileSync(requestStateFile, '{"mode":"rate-limited"}')
    const partition = fakePartition()

    await clearMpAuthState({ partition: partition as never, sessionFile })

    expect(partition.closeAllConnections).toHaveBeenCalledOnce()
    // 不传 storages 白名单：清 Electron 当前及未来支持的整个分区站点存储。
    expect(partition.clearStorageData).toHaveBeenCalledWith()
    expect(partition.clearCache).toHaveBeenCalledOnce()
    expect(partition.clearAuthCache).toHaveBeenCalledOnce()
    expect(existsSync(sessionFile)).toBe(false)
    expect(readFileSync(settingsFile, 'utf-8')).toContain('22:03')
    expect(readFileSync(requestStateFile, 'utf-8')).toContain('rate-limited')
  })

  it('session 文件本就不存在时仍可幂等退出', async () => {
    const partition = fakePartition()
    await expect(clearMpAuthState({ partition: partition as never, sessionFile: join(dir, 'missing.json') }))
      .resolves.toBeUndefined()
    expect(partition.clearStorageData).toHaveBeenCalledOnce()
  })

  it('某一步失败仍继续清其它登录态，并返回明确失败步骤', async () => {
    const sessionFile = join(dir, 'mp-session.json')
    writeFileSync(sessionFile, '{"token":"old"}')
    const partition = fakePartition({
      clearStorageData: vi.fn(async () => { throw new Error('partition busy') }),
      clearAuthCache: vi.fn(async () => { throw new Error('auth busy') }),
    })

    const error = await clearMpAuthState({ partition: partition as never, sessionFile }).catch((e) => e)

    expect(error).toBeInstanceOf(MpAuthClearError)
    expect(error).toMatchObject({
      code: 'MP_AUTH_CLEAR_FAILED',
      failedSteps: ['分区站点存储', '认证缓存'],
    })
    expect(partition.clearCache).toHaveBeenCalledOnce()
    expect(existsSync(sessionFile)).toBe(false)
  })

  it('无法删除 session 文件时不吞掉错误', async () => {
    const partition = fakePartition()
    const error = await clearMpAuthState({
      partition: partition as never,
      sessionFile: dir, // rmSync 对非空目录且无 recursive 会失败
    }).catch((e) => e)
    expect(error).toBeInstanceOf(MpAuthClearError)
    expect(error.failedSteps).toContain('本地会话文件')
  })
})

describe('全新扫码登录', () => {
  it('始终先清旧登录态，再打开扫码窗口', async () => {
    const events: string[] = []
    const value = { token: 'new', cookies: [], timestamp: 2 }
    await expect(startFreshLogin({
      clear: async () => { events.push('clear') },
      open: async () => { events.push('open'); return value },
    })).resolves.toEqual(value)
    expect(events).toEqual(['clear', 'open'])
  })

  it('扫码取消后不会恢复旧会话', async () => {
    const events: string[] = []
    await expect(startFreshLogin({
      clear: async () => { events.push('clear') },
      open: async () => { events.push('cancel'); throw new Error('CANCELLED') },
    })).rejects.toThrow('CANCELLED')
    expect(events).toEqual(['clear', 'cancel'])
  })
})
