// src/core/mowen/runner.ts
// mocli 的真实执行通道：execFile 子进程。唯一的 node:child_process 依赖点，
// 其余 core/mowen 模块只认注入的 runner（测试零子进程）。
import { execFile } from 'node:child_process'
import type { MocliRunner } from './types'

const DEFAULT_TIMEOUT_MS = 15_000

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
