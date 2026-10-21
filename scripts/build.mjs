import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assetManifest} from '../src/assets.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.mkdir(path.join(root,'dist'),{recursive:true});
const present=[];for(const [id,a] of Object.entries(assetManifest)){try{await fs.access(path.join(root,a.path));present.push(id);}catch{}}
await build({entryPoints:[path.join(root,'src/main.mjs')],bundle:true,minify:true,format:'esm',target:'chrome140',outfile:path.join(root,'dist/app.js'),legalComments:'eof',define:{'process.env.NODE_ENV':'"production"','__ASSET_FILES__':JSON.stringify(present)}});
await fs.copyFile(path.join(root,'src/index.html'),path.join(root,'dist/index.html'));
await fs.copyFile(path.join(root,'src/game.css'),path.join(root,'dist/style.css'));
await fs.cp(path.join(root,'assets'),path.join(root,'dist/assets'),{recursive:true});
console.log('Built offline game into dist/');
