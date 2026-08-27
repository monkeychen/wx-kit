import { getSession } from './mp-auth'
import { ChromiumMpTransport } from './mp-chromium-transport'
import { MpRequestAudit } from './mp-request-audit'
import { MpRequestGateway } from './mp-request-gateway'
import { FileMpRequestStateStore } from './mp-request-state'
import { getMpElectronSession, hydrateMpCookies } from './mp-session'
import { RoutingTransport, wereadCredsPath } from './weread-transport'
import { FETCH_TIMEOUT_MS, HTML_TIMEOUT_MS } from '../../src/core/fetch-html'

/** 一个进程只构造一个 runtime；持久 state/lease 再把 GUI 与独立 CLI 进程收口到一起。 */
export function createMpRuntime(userDataDir: string): MpRequestGateway {
  const ses = getMpElectronSession()
  let hydrated = false
  const chromium = new ChromiumMpTransport(ses, async () => {
    if (hydrated) return
    const value = getSession()
    if (value) await hydrateMpCookies(value, ses)
    hydrated = true
  })
  // 微信读书域名走 Node 设备传输，mp.weixin 走 Chromium —— gateway 零改动服务两条链路
  const transport = new RoutingTransport(wereadCredsPath(userDataDir), chromium)
  const audit = new MpRequestAudit(userDataDir)
  // 审计是辅助证据；磁盘写日志失败不能把已做出的保护决定改成另一种业务错误。

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
