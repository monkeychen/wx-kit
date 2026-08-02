import { getSession } from './mp-auth'
import { ChromiumMpTransport } from './mp-chromium-transport'
import { MpRequestAudit } from './mp-request-audit'
import { MpRequestGateway } from './mp-request-gateway'
import { FileMpRequestStateStore } from './mp-request-state'
import { getMpElectronSession, hydrateMpCookies } from './mp-session'
import { FETCH_TIMEOUT_MS, HTML_TIMEOUT_MS } from '../../src/core/fetch-html'

/**
 * 一个进程只构造一个 runtime；持久 state/lease 再把 GUI 与独立 CLI 进程收口到一起。
 * 测试加速只在微信网络封锁同时开启时生效，避免“测试参数”意外变成生产极速模式。
 */
export function createMpRuntime(userDataDir: string): MpRequestGateway {
  const ses = getMpElectronSession()
  let hydrated = false
  const transport = new ChromiumMpTransport(ses, async () => {
    if (hydrated) return
    const value = getSession()
    if (value) await hydrateMpCookies(value, ses)
    hydrated = true
  })
  const audit = new MpRequestAudit(userDataDir)
  // 审计是辅助证据；磁盘写日志失败不能把已做出的保护决定改成另一种业务错误。

  if (process.env.WX_KIT_BLOCK_WECHAT_NETWORK === '1' && process.env.WX_KIT_TEST_FAST_REQUESTS === '1') {
    let virtualNow = Date.now()
    return new MpRequestGateway({
      store: new FileMpRequestStateStore(userDataDir), transport,
      now: () => virtualNow,
      wait: async (ms) => { virtualNow += ms },
      audit: (event) => audit.append(event).catch(() => {}),
    })
  }

  return new MpRequestGateway({
    store: new FileMpRequestStateStore(userDataDir), transport,
    audit: (event) => audit.append(event).catch(() => {}),
  })
}

export function articleFetchers(gateway: MpRequestGateway) {
  return {
    fetchHtml: (url: string) => gateway.fetchText('article-page', url, HTML_TIMEOUT_MS),
    fetchBinary: (url: string, timeoutMs = FETCH_TIMEOUT_MS) => gateway.fetchBinary(url, timeoutMs),
  }
}
