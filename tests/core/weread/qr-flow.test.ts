// tests/core/weread/qr-flow.test.ts — Web 端扫码登录
import { describe, it, expect } from 'vitest'
import {
  getLoginUid, webConfirmUrl, buildWebPollUrl, parseWebLoginPoll, parseWebLoginSuccess,
  type QrFlowHttp,
} from '../../../src/core/weread/qr-flow'
import { MpApiError } from '../../../src/core/mp-errors'

describe('getLoginUid', () => {
  it('GET /api/auth/getLoginUid -> uid', async () => {
    const http: QrFlowHttp = {
      get: async (url) => {
        expect(url).toContain('/api/auth/getLoginUid')
        return { uid: 'UID-123' }
      },
      post: async () => ({}),
    }
    expect(await getLoginUid(http)).toBe('UID-123')
  })
  it('uid 在 data 子层', async () => {
    const http: QrFlowHttp = {
      get: async () => ({ data: { uid: 'INNER-UID' } }),
      post: async () => ({}),
    }
    expect(await getLoginUid(http)).toBe('INNER-UID')
  })
  it('缺 uid -> 抛错', async () => {
    const http: QrFlowHttp = { get: async () => ({}), post: async () => ({}) }
    await expect(getLoginUid(http)).rejects.toThrow(MpApiError)
  })
})

describe('webConfirmUrl', () => {
  it('拼出 weread web 确认页 URL', () => {
    expect(webConfirmUrl('abc')).toBe('https://weread.qq.com/web/confirm?uid=abc')
    expect(webConfirmUrl('a+b')).toContain('uid=a%2Bb')
  })
})

describe('buildWebPollUrl', () => {
  it('拼出 getLoginInfo 轮询 URL', () => {
    const u = buildWebPollUrl('U1')
    expect(u).toContain('/api/auth/getLoginInfo')
    expect(u).toContain('uid=U1')
    expect(u).toContain('otp=')
  })
})

describe('parseWebLoginPoll', () => {
  it('succeed:true -> confirmed', () => {
    const r = parseWebLoginPoll({ succeed: true, vid: 'v1', refreshToken: 'web@rt', data: {} })
    expect(r.state).toBe('confirmed')
    if (r.state === 'confirmed') expect(r.creds.vid).toBe('v1')
  })
  it('data.succeed:true -> confirmed', () => {
    expect(parseWebLoginPoll({ data: { succeed: true, vid: 'v2', refreshToken: 'web@rt2' } }).state).toBe('confirmed')
  })
  it('LOGIN_TIMEOUT -> waiting', () => {
    expect(parseWebLoginPoll({ succeed: false, logicCode: 'LOGIN_TIMEOUT' }).state).toBe('waiting')
  })
  it('NEED_OTP -> need_otp', () => {
    expect(parseWebLoginPoll({ succeed: false, logicCode: 'NEED_OTP' }).state).toBe('need_otp')
  })
  it('默认 waiting', () => {
    expect(parseWebLoginPoll({ succeed: false }).state).toBe('waiting')
  })
})

describe('parseWebLoginSuccess', () => {
  it('提取 vid/refreshToken/accessToken，refreshToken 当 wr_skey', () => {
    const c = parseWebLoginSuccess({ vid: '77', refreshToken: 'web@RT', accessToken: 'SHORT8', user: { name: '安哥' } })
    expect(c).toMatchObject({ vid: '77', refreshToken: 'web@RT', accessToken: 'SHORT8', name: '安哥' })
    expect(c.deviceId).toBe('')
  })
  it('仅 refreshToken 时 accessToken 取截断', () => {
    const c = parseWebLoginSuccess({ vid: '1', refreshToken: 'web@LONGTOKEN1234567890' })
    expect(c.refreshToken).toBe('web@LONGTOKEN1234567890')
    expect(c.accessToken).toBe('web@LONG')
  })
  it('vid 缺失 -> 抛错', () => {
    expect(() => parseWebLoginSuccess({ refreshToken: 'web@x' })).toThrow('未返回 vid')
  })
  it('双 token 都缺 -> 抛错', () => {
    expect(() => parseWebLoginSuccess({ vid: '1' })).toThrow('未返回 refreshToken')
  })
  it('嵌套 data 层提取', () => {
    const c = parseWebLoginSuccess({ data: { vid: '9', refreshToken: 'web@NEST', user: { name: 'n' } } })
    expect(c.vid).toBe('9')
  })
})
