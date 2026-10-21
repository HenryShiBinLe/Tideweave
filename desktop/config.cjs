// Windows 版的默认同步服务地址（与 Mac 版 mac/Info.plist 的 TideweaveSyncServer 相同）。
// 测试时可用环境变量 TIDEWEAVE_SYNC_SERVER 临时改，设为空字符串则不联网（同步显示离线）。
module.exports = { DEFAULT_SYNC_SERVER: "http://31.58.87.41:8080" };
