// 云同步 · HTTP 客户端
//
// 对接 server/ 的接口（docs/云同步-技术方案.md 第三部分）。只负责收发请求，不做合并，也不决定什么时候同步。
// 用标准 fetch，浏览器和 Node 都能跑；测试时可以注入自己的 fetch。

// 同步出错的类别（kind），同步层据此决定提示文字和重试节奏：
//   offline       网络不通或超时：稍后自动重试
//   rate-limited  请求太频繁：按 retryAfter 秒后重试
//   server        服务端出错（5xx）或返回的数据不对：稍后重试
//   rejected      请求被拒绝（格式、大小、同步码不对等 4xx）：重试也没用，需要提示玩家
export class SyncError extends Error {
  constructor(kind, message, detail = {}) {
    super(message);
    this.name = "SyncError";
    this.kind = kind;
    Object.assign(this, detail);
  }
}

// 从 ETag 头取版本号："3" → 3
const revOf = (response) => {
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(response.headers.get("etag") ?? "");
  return match ? Number(match[1]) : null;
};

const readJSON = (response) => response.json().catch(() => ({}));

/**
 * @param {object} options
 * @param {string} options.code 同步码（12 位大写，用 code.mjs 的 parseCode 规范化过的）
 * @param {string} [options.baseUrl] 服务地址，如 "http://1.2.3.4:8080"；和网页同源时留空
 * @param {typeof fetch} [options.fetch] 测试时注入
 * @param {number} [options.timeoutMs] 单个请求的超时
 */
export function createClient({ code, baseUrl = "", fetch: fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 10_000 }) {
  const root = baseUrl.replace(/\/+$/, "");

  async function request(method, path, headers = {}, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(root + path, { method, headers: { "X-Sync-Code": code, ...headers }, body, signal: controller.signal });
    } catch (cause) {
      throw new SyncError("offline", controller.signal.aborted ? "连接超时" : "连不上同步服务", { cause });
    } finally {
      clearTimeout(timer);
    }
  }

  async function fail(response) {
    const body = await readJSON(response);
    if (response.status === 429) throw new SyncError("rate-limited", "同步太频繁，稍后再试", { retryAfter: Number(response.headers.get("retry-after")) || 30 });
    if (response.status >= 500) throw new SyncError("server", `同步服务出错（${response.status}）`, { status: response.status });
    throw new SyncError("rejected", body.message || `同步请求被拒绝（${response.status}）`, { status: response.status, error: body.error });
  }

  return {
    /**
     * 拉取云端信封。
     * @param {number|null} [knownRev] 本机已有的云端版本号；云端没变时返回 not-modified，省流量
     * @returns {{status: "ok", rev, envelope} | {status: "not-modified", rev} | {status: "not-found"}}
     */
    async pull(knownRev = null) {
      const response = await request("GET", "/api/v1/save", knownRev === null ? {} : { "If-None-Match": `"${knownRev}"` });
      if (response.status === 404) return { status: "not-found" };
      if (response.status === 304) return { status: "not-modified", rev: knownRev };
      if (!response.ok) return fail(response);
      let envelope;
      try {
        envelope = await response.json();
      } catch {
        throw new SyncError("server", "同步服务返回的数据不是 JSON");
      }
      return { status: "ok", rev: revOf(response), envelope };
    },

    /**
     * 推送信封。
     * @param {object} envelope 信封
     * @param {number|null} rev 拉取时云端的版本号；null 表示云端还没有，只新建（已存在则冲突）
     * @returns {{status: "ok", rev} | {status: "conflict", rev} | {status: "newer-version", version}}
     */
    async push(envelope, rev) {
      const precondition = rev === null ? { "If-None-Match": "*" } : { "If-Match": `"${rev}"` };
      const response = await request("PUT", "/api/v1/save", { "Content-Type": "application/json", ...precondition }, JSON.stringify(envelope));
      if (response.status === 412) return { status: "conflict", rev: (await readJSON(response)).rev ?? null };
      if (response.status === 409) return { status: "newer-version", version: (await readJSON(response)).version };
      if (!response.ok) return fail(response);
      const body = await readJSON(response);
      return { status: "ok", rev: body.rev ?? revOf(response) };
    },
  };
}
