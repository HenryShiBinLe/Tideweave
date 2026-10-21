#!/usr/bin/env node
// 云同步服务端 · HTTP 入口
//
// 接口见 docs/云同步-技术方案.md 第三部分。零依赖，只用 Node 自带模块；不依赖游戏代码，也不解析进度内容。
// 既能被测试 import（createSyncServer），也能直接运行：node server/index.mjs
// 环境变量（PORT、HOST、DATA_DIR、STATIC_DIR、CORS_ORIGINS、TRUST_PROXY、MIN_FREE_MB）见 server/README.md
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createStore, hashCode } from "./store.mjs";

// 与 src/sync/code.mjs 一致：12 位 Crockford Base32；客户端发送前已规范化成大写
export const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{12}$/;
export const MAX_BODY_BYTES = 4 * 1024 * 1024; // 约定：存档上限 4 MB
const ENVELOPE_FORMAT = 1;
const JSON_TYPE = "application/json; charset=utf-8";
const DEFAULT_DATA_DIR = fileURLToPath(new URL("./data", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": JSON_TYPE,
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".txt", ".svg"]);

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// 检查客户端推送的信封：只看结构，不看进度内容。有问题返回中文原因，没问题返回 null
export function checkEnvelope(value, supportedVersions) {
  if (!isPlainObject(value)) return "信封必须是 JSON 对象";
  if (value.format !== ENVELOPE_FORMAT) return "不支持的信封格式";
  if (!isPlainObject(value.save)) return "缺少存档";
  if (!supportedVersions.includes(value.save.version)) return `不支持的存档版本：${JSON.stringify(value.save.version)}`;
  if (!isPlainObject(value.save.records)) return "存档缺少关卡记录";
  if (value.clock !== undefined && !isPlainObject(value.clock)) return "时间数据格式不对";
  if (value.device !== undefined && (typeof value.device !== "string" || value.device.length > 64)) return "设备标识格式不对";
  return null;
}

// 令牌桶限流：每个键（IP 或同步码）一个桶，满桶 capacity 个令牌，每秒补 refillPerSecond 个，每次请求消耗 1 个
export function createLimiter({ capacity, refillPerSecond, now = Date.now }) {
  const buckets = new Map();
  const level = (bucket, t) => Math.min(capacity, bucket.tokens + ((t - bucket.at) / 1000) * refillPerSecond);
  return {
    take(key) {
      const t = now();
      const bucket = buckets.get(key) ?? { tokens: capacity, at: t };
      bucket.tokens = level(bucket, t);
      bucket.at = t;
      buckets.set(key, bucket);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { ok: true };
      }
      return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSecond)) };
    },
    // 清掉已经补满的桶，避免内存里攒着大量早就不来的 IP
    sweep() {
      const t = now();
      for (const [key, bucket] of buckets) if (level(bucket, t) >= capacity) buckets.delete(key);
    },
  };
}

// CORS 白名单：精确匹配，或 "http://localhost:*" 这种任意端口的写法
function originMatcher(patterns) {
  return (origin) =>
    patterns.some((p) => p === origin || (p.endsWith(":*") && origin.startsWith(p.slice(0, -1)) && /^\d+$/.test(origin.slice(p.length - 1))));
}

// 解析 If-Match 里的版本号："3" 或 3；不合法返回 null
function parseRev(header) {
  const match = /^\s*(?:W\/)?"?(\d{1,15})"?\s*$/.exec(header ?? "");
  return match ? Number(match[1]) : null;
}

// If-None-Match 是否命中当前版本（支持逗号分隔的多个值和 *）
function etagMatches(header, rev) {
  if (!header) return false;
  return header.split(",").some((part) => part.trim() === "*" || parseRev(part) === rev);
}

// 日志里只记 IP 的前几段，够排查问题，又不完整记录玩家地址
function maskIp(ip = "") {
  const v4 = /(\d+\.\d+\.\d+)\.\d+$/.exec(ip);
  if (v4) return `${v4[1]}.0`;
  return ip.split(":").slice(0, 4).join(":") + "::";
}

function addVary(res, value) {
  const current = res.getHeader("Vary");
  const values = new Set(String(current ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  values.add(value);
  res.setHeader("Vary", [...values].join(", "));
}

// 带 8 位内容哈希的素材，如 /assets/nodes/node_well.15b7045d.webp、/assets/audio/sfx_clear.3f2a91c0.mp3
const HASHED_ASSET = /^\/assets\/.+\.[0-9a-f]{8}\.(webp|png|mp3|wav)$/;

// 解析单段 Range 请求头（bytes=a-b、bytes=a-、bytes=-n）。
// 返回 {start, end}；范围超出文件返回 "unsatisfiable"；多段或写法不认识返回 null（按整个文件回 200，标准允许这样做）
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
const acceptsGzip = (req) => /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");

// 读取请求体。超过上限时不能马上回 413 并断开：客户端还在上传，连接一断它只会看到写入失败（EPIPE），
// 收不到 413。所以超过上限但不离谱的请求先读完丢弃再回 413；超过 4 倍上限的明显是恶意请求，直接断开。
// 被拒时抛出的错误带 close 标记，表示回 413 时要关闭连接。
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const hardLimit = limit * 4;
    const tooLarge = (close) => Object.assign(new Error("请求体过大"), { code: "TOO_LARGE", close });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > hardLimit) {
      req.resume();
      return finish(reject, tooLarge(true));
    }
    const chunks = [];
    let size = 0, over = Number.isFinite(declared) && declared > limit;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > hardLimit) return finish(reject, tooLarge(true));
      if (size > limit) over = true;
      if (!over) chunks.push(chunk); // 超过上限后只计数、不再保存
    });
    req.on("end", () => finish(over ? reject : resolve, over ? tooLarge(false) : Buffer.concat(chunks).toString("utf8")));
    req.on("error", (error) => finish(reject, error));
  });
}

/**
 * 创建同步服务（不立即监听）。
 * @param {object} [options]
 * @param {string} [options.dataDir] 数据目录，默认 server/data
 * @param {string|null} [options.staticDir] 顺带托管的网页目录（网页版 dist/），不设则不托管
 * @param {string[]} [options.corsOrigins] 允许跨域访问的来源，默认本机预览地址
 * @param {boolean} [options.trustProxy] 前面有 nginx、Caddy 这类转发服务时为 true，按 X-Forwarded-For 认客户端 IP
 * @param {number[]} [options.supportedVersions] 接受的存档版本，默认 [1]
 * @param {number} [options.minFreeBytes] 磁盘剩余低于这个值时拒绝新建同步码，默认 500 MB
 * @param {object} [options.limits] 限流参数：{ ip, write, create }，每项 { capacity, refillPerSecond }
 * @param {number} [options.keepRecent] / [options.keepDays] 历史版本保留策略，见 store.mjs
 * @param {(entry: object) => void} [options.log] 日志函数，默认输出一行 JSON
 */
export function createSyncServer(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? DEFAULT_DATA_DIR);
  const staticDir = options.staticDir ? path.resolve(options.staticDir) : null;
  const supportedVersions = options.supportedVersions ?? [1];
  const allowOrigin = originMatcher(options.corsOrigins ?? ["http://localhost:*", "http://127.0.0.1:*"]);
  const trustProxy = !!options.trustProxy;
  const minFreeBytes = options.minFreeBytes ?? 500 * 1024 * 1024;
  const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)));
  // 默认限流按“一个班在同一个校园网出口 IP 后面一起玩”估算，留足余量
  const limits = {
    ip: { capacity: 120, refillPerSecond: 2 }, // 每个 IP：突发 120 次，之后每秒 2 次
    write: { capacity: 10, refillPerSecond: 1 / 3 }, // 每个同步码的推送：突发 10 次，之后每 3 秒 1 次
    create: { capacity: 30, refillPerSecond: 1 / 60 }, // 每个 IP 新建同步码：突发 30 个，之后每分钟 1 个
    ...options.limits,
  };
  const store = createStore({ dir: dataDir, keepRecent: options.keepRecent, keepDays: options.keepDays });
  const ipLimiter = createLimiter(limits.ip);
  const writeLimiter = createLimiter(limits.write);
  const createLimiterByIp = createLimiter(limits.create);
  const gzipCache = new Map(); // 静态文件压缩结果：路径 → { mtimeMs, size, body }
  const sweeper = setInterval(() => [ipLimiter, writeLimiter, createLimiterByIp].forEach((l) => l.sweep()), 5 * 60 * 1000);
  sweeper.unref();

  const clientIp = (req) => (trustProxy && req.headers["x-forwarded-for"]?.split(",")[0].trim()) || req.socket.remoteAddress || "";

  function send(req, res, status, body, headers = {}) {
    let buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const finalHeaders = { ...headers };
    if (buffer.length > 1024 && acceptsGzip(req)) {
      buffer = zlib.gzipSync(buffer);
      finalHeaders["Content-Encoding"] = "gzip";
      addVary(res, "Accept-Encoding");
    }
    finalHeaders["Content-Length"] = buffer.length;
    res.writeHead(status, finalHeaders);
    res.end(req.method === "HEAD" ? undefined : buffer);
  }
  const sendJSON = (req, res, status, value, headers = {}) =>
    send(req, res, status, JSON.stringify(value), { "Content-Type": JSON_TYPE, "Cache-Control": "no-store", ...headers });
  const tooMany = (req, res, retryAfter) =>
    sendJSON(req, res, 429, { error: "rate-limited", message: "请求太频繁，请稍后再试", retryAfter }, { "Retry-After": String(retryAfter) });
  const notAllowed = (req, res, allow) => sendJSON(req, res, 405, { error: "method-not-allowed", message: "不支持这个请求方法" }, { Allow: allow });

  async function freeBytes() {
    try {
      const s = await fs.statfs(dataDir);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return Infinity;
    }
  }

  // 从请求头取同步码；格式不对直接回 400 并返回 null
  function codeOf(req, res, ctx) {
    const code = req.headers["x-sync-code"];
    if (typeof code !== "string" || !CODE_PATTERN.test(code)) {
      sendJSON(req, res, 400, { error: "bad-code", message: "同步码格式不对" });
      return null;
    }
    ctx.code = hashCode(code).slice(0, 8); // 日志里只记哈希前缀，不记同步码本身
    return code;
  }

  async function getSave(req, res, ctx) {
    const code = codeOf(req, res, ctx);
    if (!code) return;
    const current = await store.get(code);
    if (!current) return sendJSON(req, res, 404, { error: "not-found", message: "云端没有这个同步码的存档" });
    ctx.rev = current.rev;
    const etag = `"${current.rev}"`;
    if (etagMatches(req.headers["if-none-match"], current.rev)) {
      res.writeHead(304, { ETag: etag, "Cache-Control": "no-store" });
      return res.end();
    }
    send(req, res, 200, current.text, { "Content-Type": JSON_TYPE, "Cache-Control": "no-store", ETag: etag });
  }

  async function putSave(req, res, ctx) {
    const code = codeOf(req, res, ctx);
    if (!code) return;
    // 乐观锁：新建用 If-None-Match: *，更新用 If-Match: "当前版本号"；两个都没有就拒绝，避免无条件覆盖
    const ifNoneMatch = req.headers["if-none-match"], ifMatch = req.headers["if-match"];
    let expect;
    if (ifNoneMatch !== undefined) {
      if (ifNoneMatch.trim() !== "*") return sendJSON(req, res, 400, { error: "bad-precondition", message: "新建存档时 If-None-Match 只能是 *" });
      expect = null;
    } else if (ifMatch !== undefined) {
      expect = parseRev(ifMatch);
      if (expect === null) return sendJSON(req, res, 400, { error: "bad-precondition", message: 'If-Match 应为版本号，例如 "3"' });
    } else {
      return sendJSON(req, res, 428, { error: "precondition-required", message: "推送必须带 If-Match（更新）或 If-None-Match: *（新建）" });
    }
    const write = writeLimiter.take(hashCode(code));
    if (!write.ok) return tooMany(req, res, write.retryAfter);
    if (expect === null) {
      const create = createLimiterByIp.take(clientIp(req));
      if (!create.ok) return tooMany(req, res, create.retryAfter);
      if ((await freeBytes()) < minFreeBytes) return sendJSON(req, res, 507, { error: "storage-full", message: "服务器存储空间不足，暂时不能新建同步码" });
    }
    let text;
    try {
      text = await readBody(req, MAX_BODY_BYTES);
    } catch (error) {
      if (error.code !== "TOO_LARGE") throw error;
      return sendJSON(req, res, 413, { error: "too-large", message: "存档超过 4 MB 上限" }, error.close ? { Connection: "close" } : {});
    }
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      return sendJSON(req, res, 400, { error: "bad-json", message: "请求体不是合法的 JSON" });
    }
    const problem = checkEnvelope(envelope, supportedVersions);
    if (problem) return sendJSON(req, res, 400, { error: "bad-envelope", message: problem });
    const result = await store.put(code, JSON.stringify(envelope), { expect, version: envelope.save.version });
    if (!result.ok && result.reason === "conflict") {
      ctx.rev = result.rev;
      const headers = result.rev === null ? {} : { ETag: `"${result.rev}"` };
      return sendJSON(req, res, 412, { error: "conflict", message: "云端已有其他设备推送的新版本，请重新拉取合并", rev: result.rev }, headers);
    }
    if (!result.ok) return sendJSON(req, res, 409, { error: "newer-version", message: "云端存档格式比这台设备新，请先更新游戏", version: result.version });
    ctx.rev = result.rev;
    sendJSON(req, res, 200, { rev: result.rev }, { ETag: `"${result.rev}"` });
  }

  async function listVersions(req, res, ctx) {
    const code = codeOf(req, res, ctx);
    if (!code) return;
    const versions = await store.versions(code);
    if (!versions.length) return sendJSON(req, res, 404, { error: "not-found", message: "云端没有这个同步码的存档" });
    sendJSON(req, res, 200, { versions });
  }

  // 顺带托管网页版（dist/）：只读，防目录穿越，按修改时间协商缓存，文本类文件 gzip
  async function serveStatic(req, res, url) {
    if (!staticDir) return sendJSON(req, res, 404, { error: "not-found", message: "这里没有网页" });
    if (req.method !== "GET" && req.method !== "HEAD") return notAllowed(req, res, "GET, HEAD");
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendJSON(req, res, 400, { error: "bad-path", message: "路径编码不对" });
    }
    const file = path.resolve(staticDir, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
    if (pathname.includes("\0") || !file.startsWith(staticDir + path.sep)) return sendJSON(req, res, 404, { error: "not-found", message: "文件不存在" });
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      stat = null;
    }
    if (!stat?.isFile()) return sendJSON(req, res, 404, { error: "not-found", message: "文件不存在" });
    const ext = path.extname(file).toLowerCase();
    const modified = Math.floor(stat.mtimeMs / 1000) * 1000;
    // 文件名带内容哈希的素材（部署时处理过的图片），内容一变名字就变，可以让浏览器缓存一年、不再回来确认；
    // 其他文件名不带哈希（index.html、app.js、style.css、字体），每次都要向服务器确认有没有更新，避免部署后浏览器还用旧文件
    const immutable = HASHED_ASSET.test(pathname);
    const headers = { "Content-Type": MIME[ext] ?? "application/octet-stream", "Last-Modified": new Date(modified).toUTCString(), "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" };
    const since = Date.parse(req.headers["if-modified-since"] ?? "");
    if (Number.isFinite(since) && modified <= since) {
      res.writeHead(304, headers);
      return res.end();
    }
    let body = await fs.readFile(file);
    // 音频等二进制文件支持按字节范围读取（206）：iOS Safari 播放 <audio> 要求服务端支持 Range，否则可能放不出来；
    // 10/21 实测 macOS 上的 WebKit 和 Chromium 不支持 Range 也能播，这里是为手机访问兜底，顺带让长音乐可以从中间续读。
    // 文本类文件会 gzip，不做范围读取（压缩后的字节偏移对不上原文件）
    if (!COMPRESSIBLE.has(ext)) {
      headers["Accept-Ranges"] = "bytes";
      // If-Range 和当前版本对不上，说明文件在两次请求之间变了，回整个新文件
      const ifRange = req.headers["if-range"];
      const range = req.headers.range && (!ifRange || ifRange === headers["Last-Modified"]) ? parseRange(req.headers.range, body.length) : null;
      if (range === "unsatisfiable") {
        res.writeHead(416, { ...headers, "Content-Range": `bytes */${body.length}`, "Content-Length": 0 });
        return res.end();
      }
      if (range) {
        const part = body.subarray(range.start, range.end + 1);
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${body.length}`, "Content-Length": part.length });
        return res.end(req.method === "HEAD" ? undefined : part);
      }
    }
    if (COMPRESSIBLE.has(ext) && acceptsGzip(req)) {
      const cached = gzipCache.get(file);
      if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) body = cached.body;
      else {
        body = zlib.gzipSync(body, { level: 9 });
        gzipCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, body });
      }
      headers["Content-Encoding"] = "gzip";
      addVary(res, "Accept-Encoding");
    }
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  }

  async function handle(req, res, ctx) {
    let url;
    // 只接受以 / 开头的普通请求路径；“*”、完整网址等其他形式本服务用不到
    if (!req.url.startsWith("/")) return sendJSON(req, res, 400, { error: "bad-path", message: "请求路径不对" });
    try {
      // 用字符串拼接而不是 new URL(req.url, base)：后者遇到“//.env”这种双斜杠开头的路径，
      // 会把它当成“//主机名/路径”，路径就变成了“/”（10/19 线上扫描器真实发过这类请求）
      url = new URL(`http://localhost${req.url}`);
    } catch {
      return sendJSON(req, res, 400, { error: "bad-path", message: "请求路径不对" });
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const origin = req.headers.origin;
    const corsAllowed = !!origin && allowOrigin(origin);
    if (corsAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Expose-Headers", "ETag, Retry-After");
      addVary(res, "Origin");
    }
    if (!url.pathname.startsWith("/api/")) return serveStatic(req, res, url);
    if (req.method === "OPTIONS") {
      if (corsAllowed) {
        res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sync-Code, If-Match, If-None-Match");
        res.setHeader("Access-Control-Max-Age", "600");
      }
      res.writeHead(204);
      return res.end();
    }
    const limited = ipLimiter.take(clientIp(req));
    if (!limited.ok) return tooMany(req, res, limited.retryAfter);
    switch (url.pathname) {
      case "/api/v1/health":
        return req.method === "GET" ? sendJSON(req, res, 200, { ok: true }) : notAllowed(req, res, "GET");
      case "/api/v1/save":
        if (req.method === "GET") return getSave(req, res, ctx);
        if (req.method === "PUT") return putSave(req, res, ctx);
        return notAllowed(req, res, "GET, PUT");
      case "/api/v1/save/versions":
        return req.method === "GET" ? listVersions(req, res, ctx) : notAllowed(req, res, "GET");
      default:
        return sendJSON(req, res, 404, { error: "not-found", message: "没有这个接口" });
    }
  }

  const server = http.createServer((req, res) => {
    const started = Date.now(), ctx = { code: null, rev: null };
    res.on("finish", () =>
      log({ time: new Date(started).toISOString(), ip: maskIp(clientIp(req)), method: req.method, path: req.url.split("?")[0], status: res.statusCode, ms: Date.now() - started, code: ctx.code, rev: ctx.rev }),
    );
    handle(req, res, ctx).catch((error) => {
      log({ time: new Date().toISOString(), level: "error", message: error.message, stack: error.stack });
      if (!res.headersSent) sendJSON(req, res, 500, { error: "internal", message: "服务端内部错误" });
      else res.destroy();
    });
  });
  // 慢速攻击的基本防护：请求头、整个请求和空闲连接都有超时
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;

  return {
    server,
    store,
    async listen(port = 0, host = "127.0.0.1") {
      await fs.mkdir(dataDir, { recursive: true });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return server.address();
    },
    close() {
      clearInterval(sweeper);
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// 直接运行时：按环境变量启动
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const app = createSyncServer({
    dataDir: env.DATA_DIR || DEFAULT_DATA_DIR,
    staticDir: env.STATIC_DIR || null,
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:*,http://127.0.0.1:*").split(",").map((s) => s.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === "1",
    minFreeBytes: Number(env.MIN_FREE_MB ?? 500) * 1024 * 1024,
  });
  const host = env.HOST || "0.0.0.0";
  const address = await app.listen(Number(env.PORT ?? 8080), host);
  console.log(`Tideweave 云同步服务已启动：http://${host}:${address.port}  数据目录：${path.resolve(env.DATA_DIR || DEFAULT_DATA_DIR)}${env.STATIC_DIR ? `  网页：${path.resolve(env.STATIC_DIR)}` : ""}`);
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}
