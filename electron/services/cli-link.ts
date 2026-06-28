// 命令行软链 + PATH 的纯文件逻辑(无 electron,参数全注入,可单测)。
import { symlink, mkdir, readlink, readFile, appendFile, unlink } from 'node:fs/promises'
import { join, delimiter } from 'node:path'

export type LinkStatus = 'linked' | 'unlinked' | 'conflict'

const PROFILE_LINE = 'export PATH="$HOME/bin:$PATH"'

/** linkPath 不存在=unlinked;是指向 target 的 symlink=linked;否则(指别处或普通文件)=conflict。 */
export async function linkStatus(linkPath: string, target: string): Promise<LinkStatus> {
  try {
    const cur = await readlink(linkPath)
    return cur === target ? 'linked' : 'conflict'
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return 'unlinked'
    if (code === 'EINVAL' || code === 'UNKNOWN') return 'conflict'   // 存在但不是 symlink
    throw e
  }
}

/** 建 linkDir 后把 linkPath 软链到 target;force=true 先删占位项再建。 */
export async function createLink(linkDir: string, linkPath: string, target: string, force = false): Promise<void> {
  await mkdir(linkDir, { recursive: true })
  if (force) { try { await unlink(linkPath) } catch { /* 无占位项 */ } }
  await symlink(target, linkPath)
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
