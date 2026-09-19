// src/core/mowen/runner.ts
// mocli 的真实执行通道：execFile 子进程。唯一的 node:child_process 依赖点，
// 其余 core/mowen 模块只认注入的 runner（测试零子进程）。
import { execFile } from 'node:child_process'
import { access, readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { MocliRunner } from './types'
import { commonBinDirs } from './locate'
import type { LocateDeps } from './locate'

const DEFAULT_TIMEOUT_MS = 15_000
const SHELL_RESOLVE_TIMEOUT_MS = 3_000

export function createMocliRunner(bin = 'mocli'): MocliRunner {
  return (args, timeoutMs = DEFAULT_TIMEOUT_MS) =>
    new Promise((resolve, reject) => {
      execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const code: string | number | undefined = (err as NodeJS.ErrnoException).code
          // ENOENT = 可执行文件不存在；非零退出：mocli 失败也会输出 JSON，把退出码带给上层判
          if (code === 'ENOENT') return reject(new Error(`mocli not found (${bin})`))
          return resolve({ code: typeof code === 'number' ? code : 1, stdout: String(stdout), stderr: String(stderr) })
        }
        resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) })
      })
    })
}

/** which/where 系统命令探测（跑的不是 mocli，故独立于 MocliRunner）。 */
export function createWhichRunner(): (cmd: string, arg: string) => Promise<{ code: number; stdout: string }> {
  return (cmd, arg) =>
    new Promise((resolve, reject) => {
      execFile(cmd, [arg], (err, stdout) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT') return reject(new Error(`${cmd} not available`))
          return resolve({ code: typeof code === 'number' ? code : 1, stdout: String(stdout) })
        }
        resolve({ code: 0, stdout: String(stdout) })
      })
    })
}

/** locateMocli 的真实 deps：fs 存在性 + login shell（`$SHELL -ilc`，带超时，dotfiles 报错即弃）。
 *  env 必须透传 HOME/SHELL：漏了会让 locateMocli 的 HOME 相对候选与 nvm 扫描整块被跳过
 *  （deps.env?.HOME === undefined），探测链在生产里永远落到 login shell 兜底——若它返回
 *  的是符号链接（如 ~/bin/mocli），注入的目录里没有 node，mocli 的 `env node` shebang
 *  解析失败 → 空 stdout → BAD_OUTPUT（v0.11.2 后本机实录）。 */
export function createLocateDeps(): LocateDeps {
  return {
    env: { HOME: process.env.HOME, SHELL: process.env.SHELL },
    exists: async (p) => {
      try { await access(p) ; return true } catch { return false }
    },
    listDir: async (dir) => {
      try { return await readdir(dir) } catch { return null }
    },
    shellResolve: (shellBin, cmd) =>
      new Promise((resolve, reject) => {
        // -i 交互加载 .zshrc（nvm 初始化多在此），非 TTY 下多数配置静默；超时/报错一律弃
        execFile(shellBin, ['-ilc', cmd], { timeout: SHELL_RESOLVE_TIMEOUT_MS }, (err, stdout) => {
          if (err) return reject(err)
          resolve({ code: 0, stdout: String(stdout) })
        })
      }),
  }
}

/** 把目录 prepend 进本进程 PATH（幂等）。 */
export function prependPathDir(dir: string): void {
  const cur = (process.env.PATH ?? '').split(':').filter(Boolean)
  if (cur.includes(dir)) return
  process.env.PATH = [dir, ...cur].join(':')
}

/**
 * 把二进制所在目录 prepend 进本进程 PATH（幂等）。GUI/受限环境里 execFile('mocli')
 * 与其 shebang `#!/usr/bin/env node` 都依赖 PATH 可达——nvm/volta/homebrew 的 bin 里
 * mocli 与 node 同住，注入目录一次解决两个可达性。locateMocli 检出路径后调用。
 */
export function injectPathDir(binPath: string | null): void {
  if (!binPath) return
  prependPathDir(dirname(binPath))
}

/**
 * 启动期 PATH 预置：把常见工具链 bin 目录（存在才加）prepend 进 PATH，幂等。
 * 防线前移——不依赖「精确探测到 mocli」，先保证 `env node` 与常见 CLI 可达；
 * 探测链（locateMocli）仍负责精确路径展示与奇葩安装位。GUI 启动与 CLI mowen
 * 命令入口各调一次。
 */
export async function injectCommonBinDirs(deps: LocateDeps = createLocateDeps()): Promise<void> {
  for (const dir of await commonBinDirs(deps)) prependPathDir(dir)
}
