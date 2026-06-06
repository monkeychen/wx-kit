// electron/protocol.ts
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const WXFILE_SCHEME = 'wxfile'

/** 把 wxfile://local/<relpath> 解析为 root 内的绝对路径；越界返回 null。 */
export function resolveWxfilePath(url: string, root: string): string | null {
  // Reject raw path traversal attempts before URL normalization absorbs them
  if (/(?:^|\/)\.\.(\/|$)/.test(url)) return null

  let u: URL
  try { u = new URL(url) } catch { return null }

  const resolvedRoot = resolve(root)

  // Decode each URL path segment individually; treat any decoded '/' as a literal
  // filename character (not a separator) by stripping leading slashes per segment.
  // This prevents %2F-encoded absolute paths from escaping the root.
  let target = resolvedRoot
  for (const seg of u.pathname.replace(/^\/+/, '').split('/')) {
    if (!seg) continue
    const safe = decodeURIComponent(seg).replace(/^\/+/, '')
    if (!safe) continue
    target = resolve(target, safe)
    if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) return null
  }
  return target
}

/** 必须在 app ready 前调用：声明协议为可加载本地资源的特权协议。 */
export function registerWxfileScheme(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { protocol } = require('electron') as typeof import('electron')
  protocol.registerSchemesAsPrivileged([
    { scheme: WXFILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ])
}

/** app ready 后调用：用 getRoot() 动态取当前库根目录。 */
export function handleWxfileProtocol(getRoot: () => string | Promise<string>): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { protocol, net } = require('electron') as typeof import('electron')
  protocol.handle(WXFILE_SCHEME, async (req) => {
    const root = await getRoot()
    const target = resolveWxfilePath(req.url, root)
    if (!target) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(target).toString())
  })
}
