const fs=require('node:fs');
const path=require('node:path');
const MAX_BYTES=4*1024*1024;
function validate(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||typeof value.records!=='object'||!value.records||Array.isArray(value.records))throw new Error('存档格式不兼容。');
  const data=JSON.stringify(value);
  if(Buffer.byteLength(data)>MAX_BYTES)throw new Error('存档超过大小限制。');
  return data;
}
function createStore(directory){
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'progress.json'),backup=file+'.bak';
  return {
    file,
    load(){
      let warning='';
      for(const candidate of [file,backup]){
        try{
          if(!fs.existsSync(candidate))continue;
          if(fs.statSync(candidate).size>MAX_BYTES)throw new Error('size');
          const value=JSON.parse(fs.readFileSync(candidate,'utf8'));validate(value);
          return {data:value,warning:candidate===backup?'主存档损坏，已恢复上一次备份。':warning};
        }catch{warning='存档无法读取，请从设置导入备份；原文件未删除。';}
      }return {data:null,warning};
    },
    save(value){
      const raw=validate(value),temporary=file+'.tmp';
      const fd=fs.openSync(temporary,'w');
      try{fs.writeFileSync(fd,raw,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      if(fs.existsSync(file)){
        try{validate(JSON.parse(fs.readFileSync(file,'utf8')));fs.copyFileSync(file,backup);}catch{}
      }
      fs.renameSync(temporary,file);return {ok:true};
    }
  };
}
module.exports={createStore,validate,MAX_BYTES};
