// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron'
import type { WxApi } from '../src/renderer/api'

const api: WxApi = {
  download: (urls, formats) => ipcRenderer.invoke('download', { urls, formats }),
  onDownloadProgress: (cb) => {
    const listener = (_e: unknown, ev: Parameters<typeof cb>[0]) => cb(ev)
    ipcRenderer.on('download:progress', listener)
    return () => { ipcRenderer.removeListener('download:progress', listener) }
  },
  libraryList: () => ipcRenderer.invoke('library:list'),
  librarySearch: (kw) => ipcRenderer.invoke('library:search', kw),
  libraryRemove: (id) => ipcRenderer.invoke('library:remove', id),
  coverName: (dir) => ipcRenderer.invoke('library:coverName', dir),
  readContent: (dir, kind) => ipcRenderer.invoke('library:readContent', { dir, kind }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  chooseDir: () => ipcRenderer.invoke('dialog:chooseDir'),
  reveal: (path) => ipcRenderer.invoke('shell:reveal', path),
}

contextBridge.exposeInMainWorld('api', api)
