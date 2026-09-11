// electron/services/mowen-detect.ts
// M60 R3:启动期检测 mocli 并把结论缓存进 settings;「重新检测」IPC 共用同一实现。
// 隔离红线(PRD R3):检测的任何失败只写 null + stderr 一行,**绝不抛**——
// mocli 装没装不该影响 wx-kit 其他功能的启动。
import { SettingsService } from './settings'
import { detectMocli } from '../../src/core/mowen/detect'
import { createMocliRunner, createWhichRunner } from '../../src/core/mowen/runner'
import { searchUsers, listUserNotes } from '../../src/core/mowen/metadata'
import { MocliFailed, MocliNotFound } from '../../src/core/mowen/errors'
import { ipcMain } from 'electron'

/** GUI 发现链路的前置检测:未装返回 null(调用方给 MOCLI_NOT_FOUND 载荷)。 */
async function mowenRunnerOrNull() {
  const r = await detectMocli(createMocliRunner(), createWhichRunner())
  return r.installed ? createMocliRunner() : null
}
function notFoundPayload() {
  const e = new MocliNotFound()
  return { ok: false as const, error: { code: 'MOCLI_NOT_FOUND', message: e.message } }
}
function mowenErrorPayload(err: unknown) {
  if (err instanceof MocliFailed) return { ok: false as const, error: { code: 'MOCLI_FAILED', reason: err.reason, message: err.message } }
  return { ok: false as const, error: { code: 'MOCLI_FAILED', reason: 'UNKNOWN', message: (err as Error).message } }
}

export async function runStartupMowenDetect(settings: SettingsService): Promise<void> {
  try {
    const r = await detectMocli(createMocliRunner(), createWhichRunner())
    await settings.save({
      mowenMocliPath: r.path,
      mowenMocliVersion: r.version,
      mowenDetectedAt: new Date().toISOString(),
    })
  } catch (e) {
    process.stderr.write(`[mowen] mocli detect failed (ignored): ${(e as Error).message}\n`)
    try { await settings.save({ mowenMocliPath: null, mowenMocliVersion: null, mowenDetectedAt: new Date().toISOString() }) }
    catch { /* 连 settings 都写不进:静默,别拖垮启动 */ }
  }
}

/** 「重新检测」按钮的即时通道:立即检一次并返回结果(同时刷新 settings 缓存)。 */
export function registerMowenIpc(settings: SettingsService): void {
  ipcMain.handle('mowen:detect', async () => {
    const r = await detectMocli(createMocliRunner(), createWhichRunner())
    await settings.save({
      mowenMocliPath: r.path,
      mowenMocliVersion: r.version,
      mowenDetectedAt: new Date().toISOString(),
    })
    return r
  })

  // —— M61:墨问发现链路（GUI tab）。前置检测,未装返回 MOCLI_NOT_FOUND(渲染层出指引) ——
  ipcMain.handle('mowen:searchUsers', async (_e, keyword: string) => {
    const run = await mowenRunnerOrNull()
    if (!run) return notFoundPayload()
    try { return { ok: true, users: await searchUsers(run, String(keyword ?? '')) } }
    catch (err) { return mowenErrorPayload(err) }
  })
  ipcMain.handle('mowen:listUserNotes', async (_e, uid: string, opts?: { filter?: string; recent?: string; count?: number }) => {
    const run = await mowenRunnerOrNull()
    if (!run) return notFoundPayload()
    try {
      return { ok: true, notes: await listUserNotes(run, String(uid ?? ''), {
        filter: opts?.filter as 'all' | 'album' | 'fee' | 'popular' | undefined,
        recent: opts?.recent, count: opts?.count,
      }) }
    } catch (err) { return mowenErrorPayload(err) }
  })
}
