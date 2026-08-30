// tests/core/weread/creds-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WereadCredsStore, refreshWereadCreds } from '../../../src/core/weread/creds-store'
import { MpAuthExpired } from '../../../src/core/mp-errors'
import type { WereadCredentials } from '../../../src/core/weread/types'
import type { QrFlowHttp } from '../../../src/core/weread/qr-flow'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'wxkit-weread-creds-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const creds: WereadCredentials = { vid: '77', accessToken: 'AT', refreshToken: 'RT', deviceId: 'dev-1', name: '安哥', updatedAt: 1 }

describe('WereadCredsStore', () => {
  it('write → read 往返', async () => {
    const store = new WereadCredsStore(join(dir, 'weread-creds.json'))
    await store.write(creds)
    expect(await store.read()).toEqual(creds)
  })
  it('落盘权限 0600（凭据文件即登录凭证）', async () => {
    const p = join(dir, 'weread-creds.json')
    await new WereadCredsStore(p).write(creds)
    const mode = (await stat(p)).mode & 0o777
    expect(mode).toBe(0o600)
  })
  it('文件不存在 → null（不抛错）', async () => {
    expect(await new WereadCredsStore(join(dir, 'none.json')).read()).toBeNull()
  })
  it('结构不合法（缺 accessToken）→ null', async () => {
    const p = join(dir, 'bad.json')
    await writeFile(p, JSON.stringify({ vid: '1' }), 'utf-8')
    expect(await new WereadCredsStore(p).read()).toBeNull()
  })
  it('JSON 损坏 → 可读错误（引导删除重扫）', async () => {
    const p = join(dir, 'corrupt.json')
    await writeFile(p, '{not json', 'utf-8')
    await expect(new WereadCredsStore(p).read()).rejects.toThrow('凭据文件损坏')
  })
  it('clear 幂等（不存在也不炸）', async () => {
    const store = new WereadCredsStore(join(dir, 'x.json'))
    await store.write(creds)
    await store.clear()
    expect(await store.read()).toBeNull()
    await store.clear()
  })
  it('成功请求后的 Cookie 快照只在变化时写回，保留其它登录字段', async () => {
    const store = new WereadCredsStore(join(dir, 'weread-creds.json'))
    await store.write({ ...creds, cookie: 'old=1' })
    expect(await store.updateCookie('new=2', 99)).toBe(true)
    expect(await store.read()).toMatchObject({ ...creds, cookie: 'new=2', updatedAt: 99 })
    expect(await store.updateCookie('new=2', 100)).toBe(false)
    expect((await store.read())?.updatedAt).toBe(99)
  })
})

describe('refreshWereadCreds', () => {
  it('成功：refreshToken 存在即返回原凭据（Web 端续期由业务 401 驱动）', async () => {
    const http: QrFlowHttp = {
      get: async () => ({}),
      post: async () => { throw new Error('不该发请求') },
    }
    const next = await refreshWereadCreds(http, creds)
    expect(next.refreshToken).toBe('RT')
    expect(next.vid).toBe('77')
    expect(next.deviceId).toBe('dev-1')
  })
  it('缺 refreshToken → MpAuthExpired（不发请求）', async () => {
    const http: QrFlowHttp = {
      get: async () => { throw new Error('不该有 GET') },
      post: async () => { throw new Error('不该有 POST') },
    }
    await expect(refreshWereadCreds(http, { ...creds, refreshToken: '' })).rejects.toThrow(MpAuthExpired)
  })
  it('deviceId 缺失不影响（Web 端无此概念）', async () => {
    const http: QrFlowHttp = { get: async () => ({}), post: async () => ({}) }
    const next = await refreshWereadCreds(http, { ...creds, deviceId: '' })
    expect(next.vid).toBe('77')
  })
})
