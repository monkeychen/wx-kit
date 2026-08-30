import { getSession } from './mp-auth'
import { ChromiumMpTransport } from './mp-chromium-transport'
import { MpRequestAudit } from './mp-request-audit'
import { MpRequestGateway } from './mp-request-gateway'
import { FileMpRequestStateStore } from './mp-request-state'
import { getMpElectronSession, hydrateMpCookies } from './mp-session'
import { wereadSessionFetch, getWereadElectronSession, WEREAD_PARTITION, wereadCookieHeader } from './weread-net'
import { RoutingTransport, wereadCredsPath, WereadNodeTransport } from './weread-transport'
import { WereadCredsStore } from '../../src/core/weread/creds-store'
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
  // 微信读书业务请求必须走 Chromium 网络栈（weread 按登录/请求端的网络栈指纹给会话分级，
  // Node fetch 的会话在 web/mp/articles 上恒 -2041，见 weread-net.ts 头注）；Cookie 头仍从
  // 凭据文件读（会话导出/迁移以文件为准），只是执行换成 Chromium。
  // mp.weixin 文章页/资源继续走既有的 Chromium 会话 —— gateway 零改动服务两条链路。
  const doFetch = (() => {
    try {
      getWereadElectronSession()   // 触发分区可用性检查；非 Electron 环境抛错时退回 Node fetch
      return (url: string, init?: RequestInit) =>
        wereadSessionFetch()(url, init) as unknown as Promise<Response>
    } catch { return globalThis.fetch }
  })()
  const credsPath = wereadCredsPath(userDataDir)
  const wereadNode = new WereadNodeTransport(credsPath, doFetch as typeof fetch, async () => {
    const cookie = await wereadCookieHeader()
    await new WereadCredsStore(credsPath).updateCookie(cookie)
  })
  void WEREAD_PARTITION
  const transport = new RoutingTransport(credsPath, chromium, wereadNode)
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
