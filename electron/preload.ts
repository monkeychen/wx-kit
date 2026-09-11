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
  libraryRebuild: () => ipcRenderer.invoke('library:rebuild'),
  libraryExportMaterial: (ids) => ipcRenderer.invoke('library:exportMaterial', ids),
  librarySyncToSite: (items, postsDir) => ipcRenderer.invoke('library:syncToSite', { items, postsDir }),
  coverName: (dir) => ipcRenderer.invoke('library:coverName', dir),
  readContent: (dir, kind) => ipcRenderer.invoke('library:readContent', { dir, kind }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  chooseDir: () => ipcRenderer.invoke('dialog:chooseDir'),
  reveal: (path) => ipcRenderer.invoke('shell:reveal', path),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  appVersion: () => ipcRenderer.invoke('app:version'),
  mowenDetect: () => ipcRenderer.invoke('mowen:detect'),
  mowenSearchUsers: (keyword: string) => ipcRenderer.invoke('mowen:searchUsers', keyword),
  mowenListUserNotes: (uid: string, opts?: { filter?: string; recent?: string; count?: number }) => ipcRenderer.invoke('mowen:listUserNotes', uid, opts),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  mpAuthStatus: () => ipcRenderer.invoke('mp:authStatus'),
  mpLogin: () => ipcRenderer.invoke('mp:login'),
  mpRelogin: () => ipcRenderer.invoke('mp:relogin'),
  mpSessionInfo: () => ipcRenderer.invoke('mp:sessionInfo'),
  mpLogout: () => ipcRenderer.invoke('mp:logout'),
  onWereadLoginQr: (cb) => {
    const listener = (_e: unknown, ev: { confirmUrl: string }) => cb(ev)
    ipcRenderer.on('weread:login:qr', listener)
    return () => { ipcRenderer.removeListener('weread:login:qr', listener) }
  },
  onWereadLoginState: (cb) => {
    const listener = (_e: unknown, ev: { state: string }) => cb(ev)
    ipcRenderer.on('weread:login:state', listener)
    return () => { ipcRenderer.removeListener('weread:login:state', listener) }
  },
  cancelWereadLogin: () => { ipcRenderer.send('weread:login:cancel') },
  mpProtectionStatus: () => ipcRenderer.invoke('mp:protectionStatus'),
  mpProtectionPause: () => ipcRenderer.invoke('mp:protectionPause'),
  mpProtectionResume: () => ipcRenderer.invoke('mp:protectionResume'),
  mpSearch: (name) => ipcRenderer.invoke('mp:search', name),
  historyList: (offset, limit) => ipcRenderer.invoke('history:list', { offset, limit }),
  historyRemove: (id) => ipcRenderer.invoke('history:remove', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  subscriptionsList: () => ipcRenderer.invoke('subscriptions:list'),
  subscriptionsAddAccount: (fakeid, nickname) => ipcRenderer.invoke('subscriptions:addAccount', { fakeid, nickname }),
  subscriptionsSetSubscribed: (fakeid, nickname, subscribed) => ipcRenderer.invoke('subscriptions:setSubscribed', { fakeid, nickname, subscribed }),
  subscriptionsRemove: (fakeid) => ipcRenderer.invoke('subscriptions:remove', fakeid),
  subscriptionsCheckNow: (fakeids) => ipcRenderer.invoke('subscriptions:checkNow', fakeids),
  subscriptionsDownloadNew: (fakeid, ids) => ipcRenderer.invoke('subscriptions:downloadNew', fakeid, ids),
  subscriptionsDownloadAllNew: () => ipcRenderer.invoke('subscriptions:downloadAllNew'),
  subscriptionsDismissNew: (fakeid, ids) => ipcRenderer.invoke('subscriptions:dismissNew', fakeid, ids),
  subscriptionsOpenLog: () => ipcRenderer.invoke('subscriptions:openLog'),
  onSubscriptionsUpdated: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('subscriptions:updated', listener)
    return () => { ipcRenderer.removeListener('subscriptions:updated', listener) }
  },
  onSubscriptionDownloadProgress: (cb) => {
    const listener = (_e: unknown, ev: Parameters<typeof cb>[0]) => cb(ev)
    ipcRenderer.on('subscriptions:download:progress', listener)
    return () => { ipcRenderer.removeListener('subscriptions:download:progress', listener) }
  },
  updateCheck: (opts) => ipcRenderer.invoke('update:check', opts),
  onUpdateAvailable: (cb) => {
    const listener = (_e: unknown, info: Parameters<typeof cb>[0]) => cb(info)
    ipcRenderer.on('update:available', listener)
    return () => { ipcRenderer.removeListener('update:available', listener) }
  },
  updateChannel: () => ipcRenderer.invoke('update:channel'),
  updateDownload: (assets) => ipcRenderer.invoke('update:downloadAsset', assets),
  onUpdateProgress: (cb) => {
    const h = (_e: unknown, p: unknown) => cb(p as never)
    ipcRenderer.on('update:progress', h)
    return () => ipcRenderer.removeListener('update:progress', h)
  },
  cliLinkStatus: () => ipcRenderer.invoke('cliLink:status'),
  cliLinkCreate: (force) => ipcRenderer.invoke('cliLink:create', force),
  cliLinkAddToPath: () => ipcRenderer.invoke('cliLink:addToPath'),
}

contextBridge.exposeInMainWorld('api', api)
