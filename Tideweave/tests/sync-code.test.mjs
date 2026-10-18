// 云同步同步码测试：生成足够随机，输入足够宽容
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCode,parseCode,formatCode,CODE_LENGTH} from '../src/sync/code.mjs';

test('生成的同步码是 12 位 Crockford Base32，且不重复',()=>{
  const codes=new Set(Array.from({length:2000},()=>generateCode()));
  assert.equal(codes.size,2000);
  for(const code of codes){assert.equal(code.length,CODE_LENGTH);assert.match(code,/^[0-9A-HJKMNP-TV-Z]{12}$/);assert.equal(parseCode(code),code);}
  // 每个字节只取低 5 位：0 → "0"，31 和 255 → "Z"
  assert.equal(generateCode(a=>a.fill(0)),'000000000000');
  assert.equal(generateCode(a=>a.fill(31)),'ZZZZZZZZZZZZ');assert.equal(generateCode(a=>a.fill(255)),'ZZZZZZZZZZZZ');
});

test('输入宽容：不分大小写，忽略空格和横线，I/L 当 1、O 当 0；不合法返回 null',()=>{
  assert.equal(parseCode(' abcd-efgh-jkmn '),'ABCDEFGHJKMN');
  assert.equal(parseCode('O0IL 1111 2222'),'001111112222');
  for(const bad of ['U000-0000-0000','ABCD-EFGH-JKM','ABCD-EFGH-JKMNP','ABCD-EFGH-JK!N','',null,123])assert.equal(parseCode(bad),null);
  assert.equal(formatCode('ABCDEFGHJKMN'),'ABCD-EFGH-JKMN');
  const code=generateCode();assert.equal(parseCode(formatCode(code)),code);
});
