// 云同步 · 一次同步
//
// 拉取 → 合并 → 推送（docs/云同步-技术方案.md 第四部分）。推送时发现别的设备抢先推过（412），
// 就重新拉取、重新合并、再推送。什么时候调用、结果怎么应用到界面，由上层（controller）决定。
import { merge } from "./merge.mjs";

export const ENVELOPE_FORMAT = 1;

/**
 * @param {ReturnType<import("./client.mjs").createClient>} client
 * @param {{save: object, clock: object}} local 本机存档和修改时间
 * @param {object} [options]
 * @param {string} [options.device] 设备标识，写进信封便于排查
 * @param {boolean} [options.create] 云端没有这个同步码时是否新建：开启新同步码时为 true；
 *   输入已有同步码时为 false，云端没有就返回 not-found，免得输错一位就悄悄建了个空码
 * @param {number} [options.maxAttempts] 冲突时最多重试几轮
 * @returns 下面之一：
 *   { status: "ok", local, localChanged, rev, pushed }：local 是本机要用的 {save, clock}（save 已 normalize）
 *   { status: "not-found" }：云端没有这个同步码（create 为 false 时）
 *   { status: "newer-version", version } / { status: "incompatible" }：云端格式比本机新或认不出，暂停同步
 *   { status: "conflict" }：重试几轮都被别的设备抢先，稍后再同步
 *   网络和服务端错误以 SyncError 抛出；合并自检失败也会抛错。出错时保留本机存档即可，云端不受影响。
 */
export async function syncOnce(client, local, { device = "", create = false, maxAttempts = 3 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pulled = await client.pull();
    if (pulled.status === "not-found" && !create) return { status: "not-found" };
    let cloud = null;
    if (pulled.status === "ok") {
      const envelope = pulled.envelope;
      if (envelope?.format !== ENVELOPE_FORMAT || !envelope.save || typeof envelope.save !== "object") return { status: "incompatible" };
      cloud = { save: envelope.save, clock: envelope.clock };
    }
    const result = merge(local, cloud);
    if (result.status !== "ok") return result;
    const rev = pulled.status === "ok" ? pulled.rev : null;
    if (!result.cloudChanged) return { status: "ok", local: result.local, localChanged: result.localChanged, rev, pushed: false };
    const pushed = await client.push({ format: ENVELOPE_FORMAT, save: result.cloud.save, clock: result.cloud.clock, device }, rev);
    if (pushed.status === "ok") return { status: "ok", local: result.local, localChanged: result.localChanged, rev: pushed.rev, pushed: true };
    if (pushed.status === "newer-version") return pushed;
    // conflict：拉取之后有别的设备推送了新版本，回到开头重新拉取、合并
  }
  return { status: "conflict" };
}
