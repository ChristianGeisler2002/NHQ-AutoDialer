import { contextBridge, ipcRenderer } from 'electron'
import type { DialerApi } from '../shared/api'

const api: DialerApi = {
  appInfo: () => ipcRenderer.invoke('app:info'),

  importLeads: (zipPaths) => ipcRenderer.invoke('leads:import', zipPaths),
  loadSampleLeads: () => ipcRenderer.invoke('leads:sample'),
  nextLead: () => ipcRenderer.invoke('leads:next'),
  getLead: (id) => ipcRenderer.invoke('leads:getById', id),
  listLeads: (filter) => ipcRenderer.invoke('leads:list', filter),
  industries: () => ipcRenderer.invoke('leads:industries'),
  leadStats: () => ipcRenderer.invoke('leads:stats'),
  updateLeadStatus: (id, status) => ipcRenderer.invoke('leads:updateStatus', id, status),
  skipLead: (id) => ipcRenderer.invoke('leads:skip', id),
  markDnc: (id, reason) => ipcRenderer.invoke('leads:markDnc', id, reason),
  precheck: (id) => ipcRenderer.invoke('leads:precheck', id),

  saveCall: (input) => ipcRenderer.invoke('calls:save', input),

  dncList: () => ipcRenderer.invoke('dnc:list'),
  dncAdd: (p) => ipcRenderer.invoke('dnc:add', p),
  dncRemove: (id) => ipcRenderer.invoke('dnc:remove', id),
  dncCheck: (phone) => ipcRenderer.invoke('dnc:check', phone),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),

  chooseZips: () => ipcRenderer.invoke('dialog:chooseZips'),
  chooseTracker: () => ipcRenderer.invoke('tracker:choose'),
  ensureTracker: () => ipcRenderer.invoke('tracker:ensure'),
  revealTracker: () => ipcRenderer.invoke('tracker:reveal'),
  openTracker: () => ipcRenderer.invoke('tracker:open'),
  openBackups: () => ipcRenderer.invoke('backups:open')
}

contextBridge.exposeInMainWorld('api', api)
