// 打包 Windows 版程序目录：release/windows/Tideweave-win32-x64/Tideweave.exe（安装包再由 desktop/installer/ 编译）
//
//   1. 构建 dist/（npm run build；SKIP_WEB_BUILD=1 时直接用现有 dist/）；
//   2. 搭一个临时打包目录：package.json 的入口指向 desktop/main.cjs，只放 desktop/*.cjs 和 dist/；
//   3. 用 node_modules 里同版本的 Windows 版 Electron 打包（Mac 上也能打：packager 会下载 win32-x64 的 Electron，缓存在本机）；
//   4. 附上说明和第三方许可证，写 release.json。
// 发布目录里有 data/（玩家存档）时拒绝覆盖；没有存档的旧产物直接替换。
//
// 要用 Node 22 运行（npm run package 已经用 npx node@22）：Node 24.16 起有个流的回归（nodejs/node#62557），
// packager 解压 Electron 用的 extract-zip 2.0.1 → yauzl 2.x 会在解压途中永远停住、进程静默退出。10/21 本机实测
// Node 26.3 卡在第一个文件，Node 22.23 正常。
import packager from '@electron/packager';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=require('../package.json');
const electronVersion=require('../node_modules/electron/package.json').version;
const out=path.join(root,'release','windows');
const dest=path.join(out,'Tideweave-win32-x64');
const exists=p=>fs.access(p).then(()=>true,()=>false);

const [major,minor]=process.versions.node.split('.').map(Number);
if(major>=25||(major===24&&minor>=16))throw new Error(`当前 Node ${process.versions.node} 解压 Electron 会卡住（见文件开头说明），请用 npm run package 或 npx -y node@22 desktop/package.mjs`);

if(await exists(path.join(dest,'data')))throw new Error(`${dest} 里有 data/（可能是玩家存档），请先改名或移走旧版本再打包。`);
await fs.rm(dest,{recursive:true,force:true});

// 1. 构建网页部分（原版构建不删旧文件，先清空 dist/，避免旧文件混进安装包）
if(process.env.SKIP_WEB_BUILD!=='1'){
  await fs.rm(path.join(root,'dist'),{recursive:true,force:true});
  execFileSync('npm',['run','build'],{cwd:root,stdio:'inherit',shell:process.platform==='win32'});
}
if(!await exists(path.join(root,'dist','index.html')))throw new Error('缺少 dist/index.html，请先 npm run build');

// 2. 临时打包目录
const stage=path.join(out,'.stage');
await fs.rm(stage,{recursive:true,force:true});
await fs.mkdir(path.join(stage,'desktop'),{recursive:true});
// 只放运行时需要的 .cjs；打包脚本、图标、安装包脚本、测试、说明都不进安装包
for(const name of await fs.readdir(path.join(root,'desktop')))if(name.endsWith('.cjs'))await fs.copyFile(path.join(root,'desktop',name),path.join(stage,'desktop',name));
await fs.cp(path.join(root,'dist'),path.join(stage,'dist'),{recursive:true});
await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,description:pkg.description,main:'desktop/main.cjs',private:true},null,2));

// 3. 打包（packager 下载 win32-x64 的 Electron，缓存在本机；写 exe 文件信息用的是纯 JS 的 resedit，Mac 上不需要 Wine）
const [dir]=await packager({dir:stage,out,name:'Tideweave',platform:'win32',arch:'x64',electronVersion,asar:true,icon:path.join(root,'desktop','Tideweave.ico'),prune:false,overwrite:true,
  win32metadata:{CompanyName:'Tideweave Project',FileDescription:'Tideweave - Graph Puzzle',ProductName:'Tideweave',InternalName:'Tideweave'}});
await fs.rm(stage,{recursive:true,force:true});

// 4. 说明、第三方许可证、release.json
for(const name of ['README.md','THIRD_PARTY_NOTICES.md'])await fs.copyFile(path.join(root,name),path.join(dir,name));
const licenseDir=path.join(dir,'licenses');await fs.mkdir(licenseDir,{recursive:true});
for(const [name,source] of [['three.txt','node_modules/three/LICENSE'],['lucide.txt','node_modules/lucide/LICENSE'],['graphology.txt','node_modules/graphology/LICENSE.txt'],['graphology-components.txt','node_modules/graphology-components/LICENSE.txt'],['graphology-shortest-path.txt','node_modules/graphology-shortest-path/LICENSE.txt'],['graphology-indices.txt','node_modules/graphology-indices/LICENSE.txt'],['graphology-types.txt','node_modules/graphology-types/LICENSE.txt'],['graphology-utils.txt','node_modules/graphology-utils/LICENSE.txt'],['mnemonist.txt','node_modules/mnemonist/LICENSE.txt'],['obliterator.txt','node_modules/obliterator/LICENSE.txt'],['events.txt','node_modules/events/LICENSE'],['yomguithereal-helpers.txt','node_modules/@yomguithereal/helpers/LICENSE.txt']]){
  await fs.copyFile(path.join(root,source),path.join(licenseDir,name));
}
const exe=path.join(dir,'Tideweave.exe');
const sha=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const {DEFAULT_SYNC_SERVER}=require('./config.cjs');
await fs.writeFile(path.join(dir,'release.json'),JSON.stringify({name:'Tideweave',version:pkg.version,platform:'Windows 10/11 x64',electron:electronVersion,sha256:await sha(exe),applicationSha256:await sha(path.join(dir,'resources','app.asar')),builtAt:new Date().toISOString(),network:'page offline; /api/ proxied by main process to sync server',syncServer:DEFAULT_SYNC_SERVER,save:'data/runtime (web storage); legacy data/progress.json migrated once',signed:false},null,2));
console.log(JSON.stringify({directory:dir,executable:exe},null,2));
