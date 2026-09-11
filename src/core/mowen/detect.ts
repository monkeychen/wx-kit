// src/core/mowen/detect.ts
// mocli 安装检测（PRD v0.11.0 R3）。只回答「装没装、在哪、什么版本」，
// 不管业务调用（那是 metadata.ts）。未安装是正常态，不抛错。
//
// 陷阱（M60 实录）：which/where 是系统命令，不是 mocli 子命令——最初把两者塞进同一个
// MocliRunner，结果真实执行的是 `mocli which mocli`（mocli 把 which 当子命令，INTERNAL 255），
// 真机上永远「未检测到」。故探测系统命令用独立的 WhichRunner，mocli 业务调用才走 MocliRunner。
import type { MocliRunner } from './types'

export interface MocliDetectResult { installed: boolean; path: string | null; version: string | null }

/** 系统命令探测（which/where），独立于 MocliRunner——它跑的不是 mocli。 */
export type WhichRunner = (cmd: string, arg: string) => Promise<{ code: number; stdout: string }>

export async function detectMocli(run: MocliRunner, which: WhichRunner): Promise<MocliDetectResult> {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  let path: string | null = null
  try {
    const r = await which(whichCmd, 'mocli')
    path = r.code === 0 ? r.stdout.trim().split(/\r?\n/)[0] || null : null
  } catch {
    return { installed: false, path: null, version: null }
  }
  if (!path) return { installed: false, path: null, version: null }

  // 版本探测失败不影响「已安装」结论
  let version: string | null = null
  try {
    const v = await run(['--version'])
    const m = /version\s+(\S+)/.exec(v.stdout)
    version = m ? m[1] : null
  } catch { /* keep null */ }
  return { installed: true, path, version }
}
