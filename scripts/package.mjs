import packager from '@electron/packager';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=require('../node_modules/electron/package.json').version;
const out=path.join(root,'release');await fs.mkdir(out,{recursive:true});
const dest=path.join(out,'Tideweave-win32-x64');
try{await fs.access(dest);throw new Error('Release folder already exists. Rename the old release before rebuilding; it may contain a player save.');}catch(e){if(e.code!=='ENOENT')throw e;}
const paths=await packager({dir:root,out,name:'Tideweave',platform:'win32',arch:'x64',electronVersion:version,electronDist:path.join(root,'node_modules/electron/dist'),asar:true,prune:false,overwrite:false,ignore:relative=>{
  const first=relative.replace(/^[\\/]/,'').split(/[\\/]/)[0];
  return !!first&&!['desktop','dist','package.json','README.md','THIRD_PARTY_NOTICES.md'].includes(first);
},win32metadata:{CompanyName:'Tideweave Project',FileDescription:'Tideweave - Offline Graph Puzzle',ProductName:'Tideweave',InternalName:'Tideweave'}});
const dir=paths[0],exe=path.join(dir,'Tideweave.exe');
await fs.copyFile(path.join(root,'README.md'),path.join(dir,'README.md'));
await fs.copyFile(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(dir,'THIRD_PARTY_NOTICES.md'));
await fs.copyFile(path.join(root,'ASSETS_NEEDED.md'),path.join(dir,'ASSETS_NEEDED.md'));
await fs.copyFile(path.join(root,'VERIFICATION.md'),path.join(dir,'VERIFICATION.md'));
const licenseDir=path.join(dir,'licenses');await fs.mkdir(licenseDir,{recursive:true});
for(const [name,source] of [['three.txt','node_modules/three/LICENSE'],['lucide.txt','node_modules/lucide/LICENSE'],['graphology.txt','node_modules/graphology/LICENSE.txt'],['graphology-components.txt','node_modules/graphology-components/LICENSE.txt'],['graphology-shortest-path.txt','node_modules/graphology-shortest-path/LICENSE.txt'],['graphology-indices.txt','node_modules/graphology-indices/LICENSE.txt'],['graphology-types.txt','node_modules/graphology-types/LICENSE.txt'],['graphology-utils.txt','node_modules/graphology-utils/LICENSE.txt'],['mnemonist.txt','node_modules/mnemonist/LICENSE.txt'],['obliterator.txt','node_modules/obliterator/LICENSE.txt'],['events.txt','node_modules/events/LICENSE'],['yomguithereal-helpers.txt','node_modules/@yomguithereal/helpers/LICENSE.txt']]){
  await fs.copyFile(path.join(root,source),path.join(licenseDir,name));
}
const hash=crypto.createHash('sha256').update(await fs.readFile(exe)).digest('hex');
const applicationSha256=crypto.createHash('sha256').update(await fs.readFile(path.join(dir,'resources/app.asar'))).digest('hex');
await fs.writeFile(path.join(dir,'release.json'),JSON.stringify({name:'Tideweave',version:'0.1.0',platform:'Windows 10/11 x64',electron:version,sha256:hash,applicationSha256,builtAt:new Date().toISOString(),network:'offline-local-files',save:'data/progress.json',signed:false},null,2));
console.log(JSON.stringify({directory:dir,executable:exe,sha256:hash},null,2));
