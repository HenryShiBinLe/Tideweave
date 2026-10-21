import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createStore}=require('../desktop/storage.cjs');
test('atomic portable storage and corrupt-primary recovery',()=>{
  const dir=path.resolve('work/test-storage-'+Date.now());fs.mkdirSync(dir,{recursive:true});
  try{const store=createStore(dir);store.save({version:1,records:{},last:'first'});store.save({version:1,records:{},last:'second'});assert.equal(store.load().data.last,'second');fs.writeFileSync(store.file,'broken');assert.equal(store.load().data.last,'first');assert.ok(store.load().warning);assert.throws(()=>store.save({version:2}));}finally{fs.rmSync(dir,{recursive:true});}
});
