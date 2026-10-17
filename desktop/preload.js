// The only bridge between the Kerf page and the computer: files, fonts, dialogs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kerfDesktop', {
  root: () => ipcRenderer.invoke('kerf:root'),
  list: () => ipcRenderer.invoke('kerf:list'),
  read: p => ipcRenderer.invoke('kerf:read', p),
  exists: p => ipcRenderer.invoke('kerf:exists', p),
  write: (p, data) => ipcRenderer.invoke('kerf:write', p, data),
  font: name => ipcRenderer.invoke('kerf:font', name),
  openDialog: () => ipcRenderer.invoke('kerf:openDialog'),
  saveDialog: suggested => ipcRenderer.invoke('kerf:saveDialog', suggested),
  reveal: p => ipcRenderer.invoke('kerf:reveal', p),
  takeFileToOpen: () => ipcRenderer.invoke('kerf:takeFileToOpen'),
  onMenu: fn => ipcRenderer.on('kerf:menu', (e, action) => fn(action)),
  onOpenPath: fn => ipcRenderer.on('kerf:openPath', (e, p) => fn(p)),
});
