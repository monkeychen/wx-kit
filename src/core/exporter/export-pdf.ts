// src/core/exporter/export-pdf.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 用离屏 BrowserWindow 加载本地 index.html 并 printToPDF。
 *  传入 electron 的 BrowserWindow 构造器以避免 core 直接耦合 electron 导入。 */
export async function writePdfFromHtml(
  dir: string,
  BrowserWindowCtor: typeof import('electron').BrowserWindow,
): Promise<void> {
  const win = new BrowserWindowCtor({ show: false, webPreferences: { offscreen: true } })
  try {
    await win.loadURL(pathToFileURL(join(dir, 'index.html')).toString())
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    await writeFile(join(dir, 'content.pdf'), pdf)
  } finally {
    win.destroy()
  }
}
