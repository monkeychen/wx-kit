import type { Session } from 'electron'

const WECHAT_HOST_SUFFIXES = ['weixin.qq.com', 'qpic.cn', 'qlogo.cn']

export class WechatNetworkBlockedError extends Error {
  readonly code = 'MP_NETWORK_BLOCKED'
  constructor(hostname: string) {
    super(`微信网络封锁模式已阻止访问 ${hostname}`)
    this.name = 'WechatNetworkBlockedError'
  }
}

export function isWechatNetworkUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return WECHAT_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  } catch { return false }
}

export function assertWechatNetworkAllowed(raw: string): void {
  if (process.env.WX_KIT_BLOCK_WECHAT_NETWORK !== '1' || !isWechatNetworkUrl(raw)) return
  throw new WechatNetworkBlockedError(new URL(raw).hostname)
}

/**
 * 离线 e2e 的第二道闸:即使未来 BrowserWindow 又新增了直连微信的页面,也在 Chromium 层取消。
 * Node HTTP 不受 webRequest 管理,所以还必须配合静态旁路扫描。
 */
export function installWechatNetworkFreeze(sessions: Session[]): void {
  if (process.env.WX_KIT_BLOCK_WECHAT_NETWORK !== '1') return
  const filter = {
    urls: [
      '*://weixin.qq.com/*', '*://*.weixin.qq.com/*',
      '*://qpic.cn/*', '*://*.qpic.cn/*',
      '*://qlogo.cn/*', '*://*.qlogo.cn/*',
    ],
  }
  for (const ses of sessions) {
    ses.webRequest.onBeforeRequest(filter, (details, callback) => {
      let host = 'wechat-host'
      try { host = new URL(details.url).hostname } catch { /* 只记脱敏 host */ }
      process.stderr.write(`[wx-kit] BLOCKED_WECHAT_NETWORK ${host}\n`)
      callback({ cancel: true })
    })
  }
}
