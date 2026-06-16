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
  libraryRemoveMany: (ids) => ipcRenderer.invoke('library:removeMany', ids),
  coverName: (dir) => ipcRenderer.invoke('library:coverName', dir),
  readContent: (dir, kind) => ipcRenderer.invoke('library:readContent', { dir, kind }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  chooseDir: () => ipcRenderer.invoke('dialog:chooseDir'),
  reveal: (path) => ipcRenderer.invoke('shell:reveal', path),
  mpAuthStatus: () => ipcRenderer.invoke('mp:authStatus'),
  mpLogin: () => ipcRenderer.invoke('mp:login'),
  mpSearch: (name) => ipcRenderer.invoke('mp:search', name),
  mpCrawl: (fakeid, nickname, range, formats) => ipcRenderer.invoke('mp:crawl', { fakeid, nickname, range, formats }),
  historyList: (offset, limit) => ipcRenderer.invoke('history:list', { offset, limit }),
  historyRemove: (id) => ipcRenderer.invoke('history:remove', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  onCrawlProgress: (cb) => {
    const listener = (_e: unknown, ev: Parameters<typeof cb>[0]) => cb(ev)
    ipcRenderer.on('mp:crawl:progress', listener)
    return () => { ipcRenderer.removeListener('mp:crawl:progress', listener) }
  },
  mpCancelCrawl: () => ipcRenderer.send('mp:crawl:cancel'),
  subscriptionsList: () => ipcRenderer.invoke('subscriptions:list'),
  subscriptionsAddAccount: (fakeid, nickname) => ipcRenderer.invoke('subscriptions:addAccount', { fakeid, nickname }),
  subscriptionsSetSubscribed: (fakeid, nickname, subscribed) => ipcRenderer.invoke('subscriptions:setSubscribed', { fakeid, nickname, subscribed }),
  subscriptionsCheckNow: () => ipcRenderer.invoke('subscriptions:checkNow'),
  subscriptionsDownloadNew: (fakeid) => ipcRenderer.invoke('subscriptions:downloadNew', fakeid),
  subscriptionsDismissNew: (fakeid) => ipcRenderer.invoke('subscriptions:dismissNew', fakeid),
  subscriptionsOpenLog: () => ipcRenderer.invoke('subscriptions:openLog'),
  onSubscriptionsUpdated: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('subscriptions:updated', listener)
    return () => { ipcRenderer.removeListener('subscriptions:updated', listener) }
  },
}

contextBridge.exposeInMainWorld('api', api)
