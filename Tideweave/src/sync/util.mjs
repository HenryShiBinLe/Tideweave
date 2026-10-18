// 云同步 · 小工具（合并、修改时间等模块共用）

// 普通对象（不含 null 和数组）
export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// 对象自身是否有这个字段（不沿原型链找）
export const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// 键按字典序排好的 JSON。用来判断两份数据是否相同，不受字段顺序影响；
// 两台设备构造同一份数据时字段顺序可能不同，直接 JSON.stringify 比较会误判为"有变化"。
export function stableJSON(value) {
  return JSON.stringify(value, (_, v) => (isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
}
