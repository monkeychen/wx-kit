// tests/core/mowen/detect.test.ts
import { describe, it, expect } from 'vitest'
import { detectMocli } from '../../../src/core/mowen/detect'
import type { MocliRunner } from '../../../src/core/mowen/types'
import type { WhichRunner } from '../../../src/core/mowen/detect'

// mocli 业务 runner(--version)
const versionOk: MocliRunner = async () => ({ code: 0, stdout: 'mocli version v0.5.4 (PROD-BUILD on 2026-08-31T16:24:45)\n', stderr: '' })
const versionFail: MocliRunner = async () => ({ code: 1, stdout: '', stderr: 'boom' })
// which 系统命令探测
const whichFound: WhichRunner = async () => ({ code: 0, stdout: '/usr/local/bin/mocli\n' })
const whichMissing: WhichRunner = async () => ({ code: 1, stdout: '' })
const whichThrows: WhichRunner = async () => { throw new Error('spawn which ENOENT') }

describe('detectMocli', () => {
  it('未安装（which 退出码非零）→ installed:false，不抛', async () => {
    expect(await detectMocli(versionOk, whichMissing)).toEqual({ installed: false, path: null, version: null })
  })

  it('which 命令本身不存在（抛错）→ installed:false，不抛', async () => {
    expect(await detectMocli(versionOk, whichThrows)).toEqual({ installed: false, path: null, version: null })
  })

  it('装了：which 给路径，--version 解析出版本号', async () => {
    const calls: string[][] = []
    const spyRunner: MocliRunner = async (args) => { calls.push(args); return versionOk(args) }
    const r = await detectMocli(spyRunner, whichFound)
    expect(r).toEqual({ installed: true, path: '/usr/local/bin/mocli', version: 'v0.5.4' })
    expect(calls[0]).toContain('--version')
  })

  it('装了但 --version 失败 → installed 仍 true，version null', async () => {
    const r = await detectMocli(versionFail, whichFound)
    expect(r.installed).toBe(true)
    expect(r.version).toBeNull()
  })
})
