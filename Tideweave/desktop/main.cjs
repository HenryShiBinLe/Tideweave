const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {createStore,validate,MAX_BYTES}=require('./storage.cjs');
app.setName('Tideweave');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
const root=app.isPackaged?path.dirname(process.execPath):path.resolve(__dirname,'..');
let directory=path.join(root,'data'),portable=true;
try{fs.mkdirSync(directory,{recursive:true});const probe=path.join(directory,'.write-check');fs.writeFileSync(probe,'');fs.unlinkSync(probe);}catch{directory=path.join(app.getPath('userData'),'saves');portable=false;fs.mkdirSync(directory,{recursive:true});}
app.setPath('userData',path.join(directory,'runtime'));
app.setPath('sessionData',path.join(directory,'runtime'));
const store=createStore(directory);
let win;
let closingConfirmed=false;
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.whenReady().then(()=>{
    win=new BrowserWindow({width:1440,height:940,minWidth:720,minHeight:620,show:false,backgroundColor:'#f1f3ef',title:'脉序 · Tideweave',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}});
    win.removeMenu();
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event,url)=>{if(url!==pathToFileURL(path.resolve(__dirname,'../dist/index.html')).href)event.preventDefault();});
    win.webContents.on('will-attach-webview',event=>event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,callback)=>callback({cancel:true}));
    const handle=(channel,fn)=>ipcMain.handle(channel,async(event,...args)=>{
      if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('请求来源无效。');
      return fn(...args);
    });
    handle('save:load',()=>({...store.load(),portable,savePath:store.file}));
    handle('save:write',value=>store.save(value));
    handle('save:export',async value=>{
      const raw=validate(value),result=await dialog.showSaveDialog(win,{title:'导出进度',defaultPath:'Tideweave-progress.json',filters:[{name:'Tideweave 存档',extensions:['json']}]});
      if(result.canceled)return false;fs.writeFileSync(result.filePath,raw,'utf8');return true;
    });
    handle('save:import',async()=>{
      const result=await dialog.showOpenDialog(win,{title:'导入进度',properties:['openFile'],filters:[{name:'Tideweave 存档',extensions:['json']}]});
      if(result.canceled)return null;
      if(fs.statSync(result.filePaths[0]).size>MAX_BYTES)throw new Error('存档过大。');
      const value=JSON.parse(fs.readFileSync(result.filePaths[0],'utf8'));validate(value);return value;
    });
    handle('window:fullscreen',()=>{win.setFullScreen(!win.isFullScreen());return win.isFullScreen();});
    handle('window:quit',()=>{app.quit();});
    handle('window:confirm-close',ok=>{if(ok===true){closingConfirmed=true;win.close();}});
    const notifyVisibility=()=>win.webContents.send('window:visibility',win.isVisible()&&!win.isMinimized());
    for(const event of ['minimize','restore','hide','show'])win.on(event,notifyVisibility);
    win.webContents.on('did-finish-load',notifyVisibility);
    win.on('close',event=>{if(!closingConfirmed){event.preventDefault();win.webContents.send('window:closing');}});
    win.once('ready-to-show',()=>win.show());
    win.loadFile(path.resolve(__dirname,'../dist/index.html'));
    win.on('closed',()=>{win=null;});
  });
  app.on('window-all-closed',()=>app.quit());
}
