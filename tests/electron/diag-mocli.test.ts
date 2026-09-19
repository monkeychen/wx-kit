// tests/electron/diag-mocli.test.ts
// M66 埋点验收:init 后 createMocliRunner 的 spawn/exit 事件真实落盘(真子进程 + tmpdir)。
// 验证的是「埋点接线」而非 logger 本身(diag-log.test.ts 已盖)。
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDiagLog, diag, resetDiagLogForTest, flushDiagLog } from '../../src/core/diag-log'
import { createMocliRunner } from '../../src/core/mowen/runner'

describe('mocli 埋点落盘(真子进程)', () => {
  afterEach(() => resetDiagLogForTest())

  it('spawn/exit 事件入 main.log,exit 带退出码/耗时/stdout 首行', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'diag-mocli-'))
    try {
      initDiagLog({ dir })
      // 用 node 替身走 mocli 的完整 spawn 链路(shebang 解析/execFile/stdout 捕获同构)
      const run = createMocliRunner(process.execPath)
      const r = await run(['-e', 'process.stdout.write("hello-mocli\\n")'])
      await flushDiagLog()
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('hello-mocli')
      const lines = (await readFile(join(dir, 'main.log'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
      const spawn = lines.find((l) => l.domain === 'mocli' && l.event === 'spawn')
      const exit = lines.find((l) => l.domain === 'mocli' && l.event === 'exit')
      expect(spawn).toBeTruthy()
      expect(spawn.bin).toBe(process.execPath)
      expect(spawn.args).toEqual(['-e', 'process.stdout.write("hello-mocli\\n")'])
      expect(exit.code).toBe(0)
      expect(typeof exit.ms).toBe('number')
      expect(exit.stdout1).toBe('hello-mocli')
    } finally {
      resetDiagLogForTest()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('未 init(测试环境常态)时埋点 null 安全,不抛不落盘', async () => {
    const run = createMocliRunner(process.execPath)
    const r = await run(['-e', ''])
    expect(r.code).toBe(0)
    expect(diag()).toBeNull()
  })
})
