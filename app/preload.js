'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('standup', {
  getState: () => ipcRenderer.invoke('get-state'),
  action: (name, payload) => ipcRenderer.invoke('action', name, payload),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  onCloseDialog: callback => {
    const listener = (_event, visible) => callback(visible);
    ipcRenderer.on('close-dialog', listener);
    return () => ipcRenderer.removeListener('close-dialog', listener);
  },
  onOpenSettings: callback => {
    const listener = () => callback();
    ipcRenderer.on('open-settings', listener);
    return () => ipcRenderer.removeListener('open-settings', listener);
  }
});
