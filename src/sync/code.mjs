// 云同步 · 同步码
//
// 同步码就是凭证：谁有它，谁就能读写这份进度。所以它必须足够随机、猜不到。
// 采用 12 位 Crockford Base32：字母表去掉了容易看错的 I、L、O 和 U，每位 5 bit，共约 60 bit；
// 再加上服务端限流，靠穷举猜中别人的同步码不现实。显示时每 4 位用横线分开：XXXX-XXXX-XXXX。

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 12;

// 生成新同步码。用 crypto.getRandomValues：HTTP 页面里也能用（crypto.randomUUID 只能在 HTTPS 下用），
// 断网时也能开启同步。getRandomValues 参数留给测试注入。
export function generateCode(getRandomValues = (array) => globalThis.crypto.getRandomValues(array)) {
  const bytes = getRandomValues(new Uint8Array(CODE_LENGTH));
  // 256 是 32 的整数倍，取低 5 位得到的 0–31 是均匀分布的，不会偏向某些字符
  return Array.from(bytes, (byte) => ALPHABET[byte & 31]).join("");
}

// 解析玩家输入的同步码：不区分大小写，忽略空格和横线，把容易看错的 I、L 当作 1，O 当作 0。
// 合法时返回 12 位大写同步码，不合法返回 null。
export function parseCode(input) {
  if (typeof input !== "string") return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

// 显示用格式：XXXX-XXXX-XXXX
export const formatCode = (code) => code.match(/.{1,4}/g).join("-");
