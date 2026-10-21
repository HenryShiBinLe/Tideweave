#!/usr/bin/env node
// 云同步服务端 · 运维脚本：在服务器上运行，和服务共用同一个数据目录（服务运行时也可以用）。
//
//   node server/admin.mjs list    <同步码>            列出历史版本
//   node server/admin.mjs show    <同步码> <版本号>    打印某个版本的信封
//   node server/admin.mjs restore <同步码> <版本号>    把旧版本作为新版本写回（回滚）
//   node server/admin.mjs stats                       同步码数量和占用空间
//
// 数据目录取环境变量 DATA_DIR，默认 server/data。同步码可以带横线、小写，和游戏里输入的规则一样。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.mjs";
import { CODE_PATTERN } from "./index.mjs";

// 与 src/sync/code.mjs 的 parseCode 规则一致：忽略空格和横线，不区分大小写，I/L 当 1、O 当 0
function parseCode(input = "") {
  const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (!CODE_PATTERN.test(code)) throw new Error(`同步码格式不对：${input}`);
  return code;
}

function parseRev(input) {
  const rev = Number(input);
  if (!Number.isInteger(rev) || rev < 1) throw new Error(`版本号应为正整数：${input}`);
  return rev;
}

const dataDir = path.resolve(process.env.DATA_DIR || fileURLToPath(new URL("./data", import.meta.url)));
const store = createStore({ dir: dataDir });
const [command, codeInput, revInput] = process.argv.slice(2);

try {
  switch (command) {
    case "list": {
      const versions = await store.versions(parseCode(codeInput));
      if (!versions.length) throw new Error("云端没有这个同步码的存档");
      console.table(versions);
      break;
    }
    case "show": {
      const text = await store.version(parseCode(codeInput), parseRev(revInput));
      if (text === null) throw new Error(`版本 ${revInput} 不存在（可能已被清理）`);
      console.log(JSON.stringify(JSON.parse(text), null, 2));
      break;
    }
    case "restore": {
      const rev = await store.restore(parseCode(codeInput), parseRev(revInput));
      console.log(`已把版本 ${revInput} 写回为新版本 ${rev}。设备下次同步时会和它合并（累积型成绩不会因此减少）。`);
      break;
    }
    case "stats": {
      const { codes, files, bytes } = await store.stats();
      console.log(`数据目录：${dataDir}\n同步码：${codes} 个，版本文件：${files} 个，占用：${(bytes / 1024 / 1024).toFixed(2)} MB`);
      break;
    }
    default:
      console.log("用法：node server/admin.mjs list|show|restore|stats [同步码] [版本号]");
      process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(`出错：${error.message}`);
  process.exitCode = 1;
}
