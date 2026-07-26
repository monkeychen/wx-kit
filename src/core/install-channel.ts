// src/core/install-channel.ts
// 识别「这份 app 是怎么装上来的」,据此给出正确的升级动作。
// 同一句「有新版」对不同渠道的用户意味着完全不同的操作 —— brew 用户该跑 brew,
// 手动装 dmg 的用户该重下 dmg。让系统承担这个判断,而不是让用户自己想。

export type InstallChannel = 'brew' | 'dmg' | 'nsis' | 'unknown'

export interface DetectDeps {
  platform: NodeJS.Platform | string
  /** 注入以便单测 */
  existsSync: (p: string) => boolean
}

/** brew cask 的安装台账目录(Apple Silicon / Intel 两个前缀) */
const CASKROOM_PATHS = ['/opt/homebrew/Caskroom/wx-kit', '/usr/local/Caskroom/wx-kit']

/**
 * 查目录而**不** fork `brew list`:后者慢,且打包后的 app 里 PATH 常不全,
 * 拿不到 brew 反而会把 brew 用户误判成手动安装、给出错误的升级指引。
 */
export function detectChannel(deps: DetectDeps): InstallChannel {
  if (deps.platform === 'win32') return 'nsis'
  if (deps.platform === 'darwin') {
    return CASKROOM_PATHS.some((p) => deps.existsSync(p)) ? 'brew' : 'dmg'
  }
  return 'unknown'
}

/**
 * brew 渠道的升级命令。**三段都不能省**:
 *  · `brew update` —— tap 是本地 clone,不更新就读到旧 cask(装完还是旧版,曾真的踩过)
 *  · `brew upgrade --cask wx-kit` —— 升级本体
 *  · `xattr -cr` —— 包未签名,quarantine 属性会让 Gatekeeper 连纯 CLI 都拦(进程挂起无输出)
 * 把这三个我们自己踩过的坑固化成一条可复制的命令,是这个功能最实的价值。
 */
export function upgradeCommand(channel: InstallChannel): string | null {
  return channel === 'brew'
    ? 'brew update && brew upgrade --cask wx-kit && xattr -cr /Applications/wx-kit.app'
    : null
}

/** 手动安装渠道的收尾提示(下载并覆盖之后还得去掉 quarantine) */
export const DMG_POST_INSTALL_HINT = 'xattr -cr /Applications/wx-kit.app'

/**
 * 按平台/架构挑安装包。资产名形如
 * `wx-kit-0.8.1-arm64.dmg` / `wx-kit-0.8.1.dmg` / `wx-kit.Setup.0.8.1.exe`。
 * 挑不到返回 null,调用方退回「打开 releases 页」让用户自己选。
 */
export function pickAsset<T extends { name: string }>(
  assets: T[], platform: NodeJS.Platform | string, arch: string,
): T | null {
  if (platform === 'win32') return assets.find((a) => a.name.endsWith('.exe')) ?? null
  if (platform !== 'darwin') return null
  const dmgs = assets.filter((a) => a.name.endsWith('.dmg'))
  const arm = dmgs.find((a) => a.name.includes('-arm64.'))
  const intel = dmgs.find((a) => !a.name.includes('-arm64.'))
  return (arch === 'arm64' ? arm ?? intel : intel ?? arm) ?? null
}
