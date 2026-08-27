// tests/electron/weread-auth.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runWereadLogin, ensureFreshWereadCreds, wereadCredsStore, WereadLoginCancelled,
} from '../../electron/services/weread-auth'
import type { QrFlowHttp } from '../../src/core/weread/qr-flow'
import { MpAuthExpired } from '../../src/core/mp-errors'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'wxkit-wa-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('runWereadLogin', () => {
  it('waiting → scanned → confirmed → 凭据落盘', async () => {
    let poll = 0
    const http: QrFlowHttp = {
      get: async (url) => {
        if (url.includes('wxticket')) return { signature: 's', timeStamp: 1 }
        if (url.includes('sdk/qrconnect')) return { errcode: 0, uuid: 'U1' }
        poll++
        return poll === 1 ? { wx_errcode: 408 }
          : poll === 2 ? { wx_errcode: 404, wx_sid: 'SID' }
          : { wx_errcode: 405, wx_code: 'WXC' }
      },
      post: async () => ({ accessToken: 'AT', refreshToken: 'RT', vid: '7', user: { name: '测' } }),
    }
    const store = wereadCredsStore(dir)
    const states: string[] = []
    const qrEvents: string[] = []
    const creds = await runWereadLogin(store, {
      runAction: async (t) => t(),
      http,
      pollIntervalMs: 1,
      now: () => 1_000,
    }, { onState: (s) => states.push(s), onQr: (q) => qrEvents.push(q.confirmUrl) })

    expect(creds.accessToken).toBe('AT')
    expect(states).toEqual(['waiting', 'scanned'])
    expect(qrEvents).toHaveLength(1)
    expect(await store.read()).toMatchObject({ accessToken: 'AT', vid: '7', name: '测' })
  })

  it('402 过期 → 自动换码重来（新一轮 wxticket）', async () => {
    let round = 0
    let ticketCalls = 0
    const http: QrFlowHttp = {
      get: async (url) => {
        if (url.includes('wxticket')) { ticketCalls++; return { signature: `s${ticketCalls}`, timeStamp: 1 } }
        if (url.includes('sdk/qrconnect')) return { errcode: 0, uuid: `U${ticketCalls}` }
        round++
        return round === 1 ? { wx_errcode: 402 } : { wx_errcode: 405, wx_code: 'OK' }
      },
      post: async () => ({ accessToken: 'AT2', refreshToken: 'RT', vid: '7', user: {} }),
    }
    const store = wereadCredsStore(dir)
    const qrEvents: string[] = []
    const creds = await runWereadLogin(store, {
      runAction: async (t) => t(), http, pollIntervalMs: 1, now: () => 1_000,
    }, { onQr: (q) => qrEvents.push(q.uuid) })
    expect(ticketCalls).toBe(2)         // 换码 = 重走 wxticket
    expect(qrEvents).toEqual(['U1', 'U2'])
    expect(creds.accessToken).toBe('AT2')
  })

  it('403 手机上取消 → MpAuthExpired（不换码死循环）', async () => {
    const http: QrFlowHttp = {
      get: async (url) =>
        url.includes('wxticket') ? { signature: 's', timeStamp: 1 }
          : url.includes('sdk/qrconnect') ? { errcode: 0, uuid: 'U1' }
          : { wx_errcode: 403 },
      post: async () => { throw new Error('不该到这') },
    }
    await expect(runWereadLogin(wereadCredsStore(dir), { runAction: async (t) => t(), http, pollIntervalMs: 1, now: () => 1_000 }))
      .rejects.toThrow(MpAuthExpired)
  })

  it('cancel() → 立即中断（WereadLoginCancelled）', async () => {
    const http: QrFlowHttp = {
      get: async (url) =>
        url.includes('wxticket') ? { signature: 's', timeStamp: 1 }
          : url.includes('sdk/qrconnect') ? { errcode: 0, uuid: 'U1' }
          : { wx_errcode: 408 },
      post: async () => { throw new Error('不该到这') },
    }
    let polls = 0
    await expect(runWereadLogin(wereadCredsStore(dir), {
      runAction: async (t) => t(), http, pollIntervalMs: 1, now: () => 1_000,
    }, {
      onState: () => { polls++ },
      cancel: () => polls >= 2,
    })).rejects.toThrow(WereadLoginCancelled)
  })
})

describe('ensureFreshWereadCreds', () => {
  it('无凭据 → MpAuthExpired 引导登录', async () => {
    await expect(ensureFreshWereadCreds(wereadCredsStore(dir))).rejects.toThrow('尚未登录')
  })
  it('无 refreshToken → 原样返回（交业务请求检验）', async () => {
    const store = wereadCredsStore(dir)
    await store.write({ vid: '7', accessToken: 'AT', refreshToken: '', deviceId: 'd', name: '', updatedAt: 0 })
    const c = await ensureFreshWereadCreds(store)
    expect(c.accessToken).toBe('AT')
  })
  it('续期成功 → 新凭据落盘', async () => {
    const store = wereadCredsStore(dir)
    await store.write({ vid: '7', accessToken: 'OLD', refreshToken: 'RT', deviceId: 'd', name: '', updatedAt: 0 })
    const http: QrFlowHttp = {
      get: async () => { throw new Error('no get') },
      post: async () => ({ accessToken: 'NEW', refreshToken: 'RT2', vid: '7', user: { name: '测' } }),
    }
    const c = await ensureFreshWereadCreds(store, http)
    expect(c.accessToken).toBe('NEW')
    expect((await store.read())?.refreshToken).toBe('RT2')
  })
  it('续期失败 → 返回旧凭据（accessToken 可能仍在有效期，不误杀）', async () => {
    const store = wereadCredsStore(dir)
    await store.write({ vid: '7', accessToken: 'OLD', refreshToken: 'RT', deviceId: 'd', name: '', updatedAt: 0 })
    const http: QrFlowHttp = {
      get: async () => { throw new Error('no get') },
      post: async () => { throw new Error('network down') },
    }
    const c = await ensureFreshWereadCreds(store, http)
    expect(c.accessToken).toBe('OLD')
  })
})
