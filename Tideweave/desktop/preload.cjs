const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('tideweave',Object.freeze({
  load:()=>ipcRenderer.invoke('save:load'),
  save:data=>ipcRenderer.invoke('save:write',data),
  export:data=>ipcRenderer.invoke('save:export',data),
  import:()=>ipcRenderer.invoke('save:import'),
  fullscreen:()=>ipcRenderer.invoke('window:fullscreen'),
  quit:()=>ipcRenderer.invoke('window:quit')
  ,onClosing:callback=>ipcRenderer.on('window:closing',()=>callback())
  ,confirmClose:ok=>ipcRenderer.invoke('window:confirm-close',ok)
}));
