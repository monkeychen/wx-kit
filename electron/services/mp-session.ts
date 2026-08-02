import { session, type Session } from 'electron'
import type { MpSession } from '../../src/core/mp-types'

export const MP_PARTITION = 'persist:mpweixin'
export const MP_ORIGIN = 'https://mp.weixin.qq.com/'

export function getMpElectronSession(): Session {
  return session.fromPartition(MP_PARTITION)
}

/**
 * 兼容旧版/跨机器导入的 name/value Cookie 文件:仅在 Chromium Cookie Jar 为空时恢复。
 * 分区已有 Cookie 时绝不拿旧文件覆盖，运行时演进以 Chromium 为唯一真相。
 */
export async function hydrateMpCookies(value: MpSession, ses: Session = getMpElectronSession()): Promise<void> {
  if ((await ses.cookies.get({ url: MP_ORIGIN })).length > 0) return
  for (const cookie of value.cookies) {
    await ses.cookies.set({ url: MP_ORIGIN, name: cookie.name, value: cookie.value, secure: true })
  }
}

export async function hasMpCookies(ses: Session = getMpElectronSession()): Promise<boolean> {
  return (await ses.cookies.get({ url: MP_ORIGIN })).length > 0
}
