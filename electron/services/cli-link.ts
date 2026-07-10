// 命令行快捷命令 + PATH 的纯文件逻辑(无 electron,参数全注入,可单测)。
import { mkdir, readlink, readFile, writeFile, appendFile, unlink } from 'node:fs/promises'
import { join, delimiter } from 'node:path'

// 'legacy' = 指向 target 的旧版 symlink(≤v0.5.1 的形态):mac 上 Electron 按调用路径
// 定位 bundle 内 Helper app,经软链调用找不到 → download 等需子进程的命令必崩,须升级为 wrapper。
export type LinkStatus = 'linked' | 'unlinked' | 'conflict' | 'legacy'

const PROFILE_LINE = 'export PATH="$HOME/bin:$PATH"'

/** 命令行入口的 wrapper 脚本:exec 真实路径,让 Electron 以 bundle 内路径定位 Helper app。 */
export function wrapperScript(target: string): string {
  return `#!/bin/sh\nexec "${target}" "$@"\n`
}

/**
 * linkPath 不存在=unlinked;内容等于目标 wrapper 的普通文件=linked;
 * 指向 target 的旧版 symlink=legacy(坏的,待自愈升级);其余占位=conflict。
 */
export async function linkStatus(linkPath: string, target: string): Promise<LinkStatus> {
  try {
    const cur = await readlink(linkPath)
    return cur === target ? 'legacy' : 'conflict'
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return 'unlinked'
    if (code !== 'EINVAL' && code !== 'UNKNOWN') throw e
    // 存在但不是 symlink:比对 wrapper 内容
    const content = await readFile(linkPath, 'utf-8').catch(() => '')
    return content === wrapperScript(target) ? 'linked' : 'conflict'
  }
}

/** 建 linkDir 后在 linkPath 写指向 target 的 wrapper 脚本;force=true 先删占位项再建。 */
export async function createLink(linkDir: string, linkPath: string, target: string, force = false): Promise<void> {
  await mkdir(linkDir, { recursive: true })
  // 必须先删旧项再写:linkPath 若是 symlink,直接 writeFile 会写穿到其指向的目标
  if (force) { try { await unlink(linkPath) } catch { /* 无占位项 */ } }
  await writeFile(linkPath, wrapperScript(target), { mode: 0o755, flag: 'wx' })
}

/** dir 是否作为完整一项出现在 PATH 里。纯函数。 */
export function pathContains(dir: string, pathEnv: string | undefined): boolean {
  if (!pathEnv) return false
  return pathEnv.split(delimiter).some((p) => p === dir)
}

/** 幂等地把 export 行追加进 profile;已存在则不重复加。 */
export async function ensureInProfile(profilePath: string, line: string = PROFILE_LINE): Promise<'added' | 'present'> {
  let content = ''
  try { content = await readFile(profilePath, 'utf-8') } catch { /* 新文件 */ }
  if (content.split('\n').some((l) => l.trim() === line)) return 'present'
  const prefix = content.length && !content.endsWith('\n') ? '\n' : ''
  await appendFile(profilePath, `${prefix}${line}\n`)
  return 'added'
}

/** 按 $SHELL 选 rc 文件:zsh→.zshrc、bash→.bashrc、其它→.profile。纯函数。 */
export function profilePathFor(shell: string | undefined, home: string): string {
  if (shell?.includes('zsh')) return join(home, '.zshrc')
  if (shell?.includes('bash')) return join(home, '.bashrc')
  return join(home, '.profile')
}
