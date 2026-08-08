import { chmod, mkdir, open, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../../src/core/atomic-write'
import { withPathLock } from '../../src/core/path-lock'
import {
  isMpRequestState,
  activeRequestState,
  type MpRequestState,
} from '../../src/core/mp-request-governor'

export interface MpStateUpdate<T> { state: MpRequestState; value: T }

export interface MpRequestStateStore {
  read(): Promise<MpRequestState>
  update<T>(fn: (state: MpRequestState) => MpStateUpdate<T> | Promise<MpStateUpdate<T>>): Promise<T>
}

export interface FileMpRequestStateStoreOptions {
  lockTimeoutMs?: number
  staleLockMs?: number
  wait?: (ms: number) => Promise<void>
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * GUI 与 CLI 是两个 Electron 进程，模块内 Promise 锁挡不住它们。
 * 这里用一个短期排他 lease 只保护「读状态→决策→写状态」；网络请求期间不持锁。
 */
export class FileMpRequestStateStore implements MpRequestStateStore {
  private readonly statePath: string
  private readonly lockPath: string
  private readonly lockTimeoutMs: number
  private readonly staleLockMs: number
  private readonly wait: (ms: number) => Promise<void>

  constructor(private readonly storeDir: string, opts: FileMpRequestStateStoreOptions = {}) {
    this.statePath = join(storeDir, 'mp-request-state.json')
    this.lockPath = join(storeDir, 'mp-request-state.lock')
    this.lockTimeoutMs = opts.lockTimeoutMs ?? 5_000
    this.staleLockMs = opts.staleLockMs ?? 30_000
    this.wait = opts.wait ?? delay
  }

  async read(): Promise<MpRequestState> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.statePath, 'utf-8'))
      if (!isMpRequestState(parsed)) throw new Error('shape')
      return parsed
    } catch (e) {
      // M49：请求保护已无用户恢复入口。新安装必须允许用户明确触发的 URL 下载，
      // 不能因缺少旧治理状态文件而永久暂停。
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return activeRequestState()
      return {
        ...activeRequestState(),
        pausedReason: `微信请求保护状态文件损坏，已按默认状态重建：${this.statePath}`,
      }
    }
  }

  async update<T>(fn: (state: MpRequestState) => MpStateUpdate<T> | Promise<MpStateUpdate<T>>): Promise<T> {
    // 同一进程先排队，避免自己制造大量 lock 文件竞争；跨进程再靠 acquireLease。
    return withPathLock(this.lockPath, () => this.withLease(async () => {
      const current = await this.read()
      const { state, value } = await fn(current)
      await mkdir(this.storeDir, { recursive: true })
      await atomicWriteFile(this.statePath, JSON.stringify(state, null, 2))
      await chmod(this.statePath, 0o600).catch(() => {})
      return value
    }))
  }

  private async withLease<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(this.storeDir, { recursive: true })
    const started = Date.now()
    let handle: Awaited<ReturnType<typeof open>> | null = null
    for (;;) {
      try {
        handle = await open(this.lockPath, 'wx', 0o600)
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }))
        break
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        const info = await stat(this.lockPath).catch(() => null)
        if (info && Date.now() - info.mtimeMs > this.staleLockMs) {
          await unlink(this.lockPath).catch(() => {})
          continue
        }
        if (Date.now() - started >= this.lockTimeoutMs) {
          throw new Error('MP_STATE_LOCK_TIMEOUT: 无法取得微信请求保护状态锁，已拒绝联网')
        }
        await this.wait(25)
      }
    }

    try { return await fn() }
    finally {
      await handle?.close().catch(() => {})
      await unlink(this.lockPath).catch(() => {})
    }
  }
}
