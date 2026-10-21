// 解析 HTTP Range 请求头：同步服务托管网页版（server/index.mjs）和 Windows 版的 tideweave:// 协议（desktop/protocol.cjs）共用。
// 放在 server/ 里，是因为部署到 VPS 时只上传 server/ 这一个目录；Windows 版打包时会把这个文件一起带上（desktop/package.mjs）。
// 写成 CommonJS：ESM 的服务端可以 import，CommonJS 的 Electron 外壳可以 require。

// 只认单段（bytes=a-b、bytes=a-、bytes=-n）。
// 返回 {start, end}；范围超出文件返回 "unsatisfiable"（回 416）；多段或写法不认识返回 null（按整个文件回 200，标准允许这样做）
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // 后缀形式：最后 n 个字节
    const n = Number(m[2]);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]), end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (m[2] !== "" && Number(m[2]) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end };
}

module.exports = { parseRange };
