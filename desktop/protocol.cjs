// Windows 版 · 自定义协议 tideweave://app/ 的处理逻辑（与 Mac 版 mac/Sources/BundleSchemeHandler.swift 对应）
//
// 为什么不用 file://：file:// 页面的源是 null，同步层要发同源请求、CSP 的 'self' 也对不上。
// 改用 tideweave://app/ 后：
//   - 普通路径从打包进来的 dist/ 读文件；音频等二进制文件支持 Range（206），<audio> 可以按段读取；
//   - /api/ 开头的请求由主进程转发给同步服务。对网页来说仍是同源请求，CSP 和服务端跨域设置都不用改；
//     网页本身仍然连不了任何外网地址（main.cjs 拦截 http/https/ws）。
// 这里只用标准的 Request / Response / fetch，不依赖 Electron，方便在 Node 里测试（tests/desktop-shell.test.mjs）。
const fs = require("node:fs/promises");
const path = require("node:path");

const SCHEME = "tideweave";
const HOST = "app";
const ENTRY = `${SCHEME}://${HOST}/index.html`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

// 只转发同步协议用到的请求头 / 响应头（与 Mac 版一致）
const FORWARDED_REQUEST_HEADERS = ["content-type", "x-sync-code", "if-match", "if-none-match"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "etag", "retry-after"];
const PROXY_TIMEOUT_MS = 10_000;

const status = (code) => new Response(null, { status: code });

// 解析单段 Range（bytes=a-b、bytes=a-、bytes=-n），规则与 server/index.mjs 相同。
// 返回 {start, end}；超出文件返回 "unsatisfiable"；多段或写法不认识返回 null（回整个文件）
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]), end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (m[2] !== "" && Number(m[2]) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end };
}

async function serveFile(request, url, root) {
  if (request.method !== "GET" && request.method !== "HEAD") return status(405);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return status(400);
  }
  if (pathname === "" || pathname === "/") pathname = "/index.html";
  // 防目录穿越：解析后的路径必须仍在 dist/ 之内
  const file = path.resolve(root, "." + pathname);
  if (pathname.includes("\0") || !file.startsWith(root + path.sep)) return status(403);
  let body;
  try {
    body = await fs.readFile(file);
  } catch {
    return status(404);
  }
  const headers = { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Accept-Ranges": "bytes" };
  const range = request.headers.get("range") ? parseRange(request.headers.get("range"), body.length) : null;
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${body.length}` } });
  if (range) {
    const part = body.subarray(range.start, range.end + 1);
    return new Response(request.method === "HEAD" ? null : part, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${body.length}`, "Content-Length": String(part.length) },
    });
  }
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers: { ...headers, "Content-Length": String(body.length) } });
}

async function proxy(request, url, syncServer, fetchImpl) {
  // 没配同步服务：让同步层看到 503，显示“离线，稍后重试”
  if (!syncServer) return status(503);
  const target = new URL(syncServer);
  target.pathname = target.pathname.replace(/\/+$/, "") + url.pathname;
  target.search = url.search;
  const headers = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  const method = request.method;
  const body = method === "GET" || method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer());
  // 连不上服务时直接抛错：网页里的 fetch 会失败，同步层据此显示“离线，稍后重试”
  const upstream = await fetchImpl(target, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) });
  const out = {};
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) out[name] = value;
  }
  // 304 等不能带响应体的状态，要传 null
  const noBody = upstream.status === 204 || upstream.status === 304 || method === "HEAD";
  return new Response(noBody ? null : await upstream.arrayBuffer(), { status: upstream.status, headers: out });
}

// root：dist/ 目录；syncServer：同步服务地址（如 http://31.58.87.41:8080），为空时 /api/ 一律 503
function createHandler({ root, syncServer, fetch: fetchImpl = globalThis.fetch }) {
  const resolvedRoot = path.resolve(root);
  return async (request) => {
    const url = new URL(request.url);
    if (url.protocol !== `${SCHEME}:` || url.host !== HOST) return status(400);
    if (url.pathname.startsWith("/api/")) return proxy(request, url, syncServer, fetchImpl);
    return serveFile(request, url, resolvedRoot);
  };
}

module.exports = { SCHEME, HOST, ENTRY, createHandler, parseRange };
