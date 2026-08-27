// tests/core/weread/qr-flow.test.ts
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  startQrLogin, parseQrPoll, buildPollUrl, buildLoginBody, buildRefreshBody,
  parseLoginResponse, exchangeQrCode, newDeviceId, newInstallId, wereadSignature,
  type QrFlowHttp,
} from '../../../src/core/weread/qr-flow'
import { MpApiError } from '../../../src/core/mp-errors'

describe('startQrLogin', () => {
  it('wxticket → qrconnect → {uuid, confirmUrl}', async () => {
    const http: QrFlowHttp = {
      get: async (url) => {
        if (url.includes('wxticket')) return { signature: 'sig123', timeStamp: 1787739986 }
        if (url.includes('qrconnect')) {
          expect(url).toContain('appid=wxab9b71ad2b90ff34')
          expect(url).toContain('signature=sig123')
          expect(url).toContain('timestamp=1787739986')
          return { errcode: 0, uuid: 'uuid-XYZ' }
        }
        throw new Error(`unexpected url ${url}`)
      },
      post: async () => { throw new Error('no post expected') },
    }
    const r = await startQrLogin(http)
    expect(r.uuid).toBe('uuid-XYZ')
    expect(r.confirmUrl).toBe('https://open.weixin.qq.com/connect/confirm?uuid=uuid-XYZ')
  })
  it('wxticket 缺 signature → 报错', async () => {
    const http: QrFlowHttp = { get: async () => ({}), post: async () => ({}) }
    await expect(startQrLogin(http)).rejects.toThrow(MpApiError)
  })
  it('qrconnect errcode != 0 → 报错', async () => {
    const http: QrFlowHttp = {
      get: async (url) => url.includes('wxticket') ? { signature: 's', timeStamp: 1 } : { errcode: -100 },
      post: async () => ({}),
    }
    await expect(startQrLogin(http)).rejects.toThrow('微信二维码生成失败')
  })
})

describe('parseQrPoll · wx_errcode 状态机', () => {
  it.each([
    [{ wx_errcode: 408 }, { state: 'waiting' }],
    [{ wx_errcode: 404 }, { state: 'scanned' }],
    [{ wx_errcode: 402 }, { state: 'expired' }],
    [{ wx_errcode: 403 }, { state: 'declined' }],
  ] as const)('%j → %j', (payload, expected) => {
    expect(parseQrPoll(payload)).toEqual(expected)
  })
  it('405 带 wx_code → confirmed', () => {
    expect(parseQrPoll({ wx_errcode: 405, wx_code: 'CODE' })).toEqual({ state: 'confirmed', wxCode: 'CODE' })
  })
  it('405 无 wx_code → 报错（不能静默卡死）', () => {
    expect(() => parseQrPoll({ wx_errcode: 405 })).toThrow(MpApiError)
  })
  it('未知码 → 报错', () => {
    expect(() => parseQrPoll({ wx_errcode: 999 })).toThrow('未知扫码状态')
  })
})

describe('buildPollUrl', () => {
  it('首帧无 last，续帧带 last（长轮询续接键）', () => {
    expect(buildPollUrl('u1')).not.toContain('last=')
    expect(buildPollUrl('u1', 'sid9')).toContain('last=sid9')
    expect(buildPollUrl('u1', null)).not.toContain('last=')
  })
})

describe('设备标识与签名', () => {
  it('newDeviceId 形态：前缀 + 19 位数字', () => {
    const id = newDeviceId()
    expect(id).toMatch(/^eink334691225\d{19}$/)
  })
  it('newInstallId 形态：前缀 + 26 位数字', () => {
    expect(newInstallId()).toMatch(/^eink31\d{26}$/)
  })
  it('wereadSignature = sha256(ts+deviceId+random)', () => {
    // 与 spike 脚本/参考实现一致的确定性向量
    const expected = createHash('sha256').update('1000einkdev5').digest('hex')
    expect(wereadSignature(1000, 'einkdev', 5)).toBe(expected)
  })
})

describe('登录/续期请求体', () => {
  it('buildLoginBody 含签名与设备画像字段', () => {
    const body = buildLoginBody({ wxCode: 'C', deviceId: 'D', installId: 'I', random: 7, timestampMs: 123 })
    expect(body.code).toBe('C')
    expect(body.deviceName).toBe('BOOX')
    expect(body.deviceType).toBe(3)
    expect(body.signature).toBe(wereadSignature(123, 'D', 7))
  })
  it('buildRefreshBody 用 refreshToken + kickType 1，随机数与签名一致', () => {
    const creds = { vid: 'v', accessToken: 'a', refreshToken: 'rt', deviceId: 'dev-x', name: 'n', updatedAt: 0 }
    const body = buildRefreshBody(creds, 42, 999)
    expect(body.refreshToken).toBe('rt')
    expect(body.kickType).toBe(1)
    expect(body.signature).toBe(wereadSignature(999, 'dev-x', 42))
  })
})

describe('parseLoginResponse', () => {
  const ok = { accessToken: 'AT', refreshToken: 'RT2', vid: '77', user: { name: '安哥' } }
  it('成功：落成凭据（含 user.name 与 updatedAt）', () => {
    const c = parseLoginResponse(ok, 'dev-1')
    expect(c).toMatchObject({ vid: '77', accessToken: 'AT', refreshToken: 'RT2', deviceId: 'dev-1', name: '安哥' })
    expect(c.updatedAt).toBeGreaterThan(0)
  })
  it('缺 accessToken → 带错误码的失败', () => {
    expect(() => parseLoginResponse({ errCode: -2, errMsg: 'bad code' }, 'd')).toThrow('微信读书登录失败')
  })
})

describe('exchangeQrCode', () => {
  it('POST /login 并返回凭据', async () => {
    let seen: { url: string; body: unknown } | null = null
    const http: QrFlowHttp = {
      get: async () => { throw new Error('no get') },
      post: async (url, body) => { seen = { url, body }; return { accessToken: 'AT', refreshToken: 'R', vid: '1', user: {} } },
    }
    const c = await exchangeQrCode(http, 'WXC', { deviceId: 'dev-9', installId: 'ins-1' }, () => 555)
    expect(seen!.url).toBe('https://i.weread.qq.com/login')
    expect((seen!.body as Record<string, unknown>).code).toBe('WXC')
    expect(c.deviceId).toBe('dev-9')
    expect(c.accessToken).toBe('AT')
  })
})
