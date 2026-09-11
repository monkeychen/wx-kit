// electron/services/mowen-detect.ts
// M60 R3:启动期检测 mocli 并把结论缓存进 settings;「重新检测」IPC 共用同一实现。
// 隔离红线(PRD R3):检测的任何失败只写 null + stderr 一行,**绝不抛**——
// mocli 装没装不该影响 wx-kit 其他功能的启动。
import { SettingsService } from './settings'
import { detectMocli } from '../../src/core/mowen/detect'
import { createMocliRunner, createWhichRunner } from '../../src/core/mowen/runner'
import { ipcMain } from 'electron'

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
}
