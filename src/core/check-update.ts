// src/core/check-update.ts
// 向 GitHub 查最新发布版本。**只做检查,不做静默自更新**——
// mac 侧的包是 adhoc 签名,Squirrel.Mac 的签名校验必败;而且 brew 是必做分发渠道,
// app 自己替换二进制会让 brew 的版本账本对不上(理由详见 docs/PRD-v0.8.2.md R3)。
import { compareVersions } from './version-compare'

const LATEST_RELEASE_API = 'https://api.github.com/repos/monkeychen/wx-kit/releases/latest'
/** 启动时会静默调用,不能让用户等 —— 超时就当查不到 */
const DEFAULT_TIMEOUT_MS = 8000

export interface UpdateAsset { name: string; url: string; size: number }
export interface UpdateInfo {
  current: string
  latest: string
  hasUpdate: boolean
  /** release body(markdown 原文),给用户看「这版改了什么」 */
  notes: string
  publishedAt: string
  assets: UpdateAsset[]
}

export interface CheckUpdateDeps {
  /** 注入以便单测;默认用全局 fetch */
  fetchJson?: (url: string, init?: { signal?: AbortSignal }) => Promise<unknown>
  timeoutMs?: number
}

/**
 * 查一次最新版。
 *
 * **任何失败都返回 null,绝不抛**:断网、限流、字段缺失、超时都算「这次没查到」。
 * 启动时的静默检查若能抛异常,就会变成用户一开应用就看见错误——那是最糟的引入方式。
 *
 * 网络走 Node 的 `fetch`,它**不读 `http_proxy` 环境变量**,天然直连 —— 正好符合项目
 * 「访问 github 一律不走代理」的规约(本机 8118 代理对 github 会卡死)。别改用会读系统代理的取包方式。
 */
export async function checkUpdate(
  currentVersion: string,
  deps: CheckUpdateDeps = {},
): Promise<UpdateInfo | null> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchJson = deps.fetchJson ?? (async (url: string, init?: { signal?: AbortSignal }) => {
    const res = await fetch(url, {
      ...init,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wx-kit' },
    })
    if (!res.ok) throw new Error(`github api ${res.status}`)
    return res.json()
  })

  try {
    const raw = await fetchJson(LATEST_RELEASE_API, { signal: AbortSignal.timeout(timeoutMs) }) as {
      tag_name?: string; body?: string; published_at?: string
      draft?: boolean; prerelease?: boolean
      assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>
    }
    // 草稿与预发布不该推给用户 —— 草稿甚至可能是还没传完附件的半成品
    if (!raw || raw.draft || raw.prerelease) return null
    const latest = String(raw.tag_name ?? '').replace(/^v/i, '')
    if (!latest) return null

    return {
      current: currentVersion,
      latest,
      hasUpdate: compareVersions(latest, currentVersion) > 0,
      notes: String(raw.body ?? ''),
      publishedAt: String(raw.published_at ?? ''),
      assets: (raw.assets ?? [])
        .filter((a) => a.name && a.browser_download_url)
        .map((a) => ({ name: String(a.name), url: String(a.browser_download_url), size: Number(a.size ?? 0) })),
    }
  } catch {
    return null
  }
}
