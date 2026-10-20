#!/bin/bash
# 构建 Mac 原生版：编译前端 dist/ → swiftc 编译 Swift 壳 → 组装 Tideweave.app → ad-hoc 签名。
# 只需 Xcode 命令行工具（不需要完整 Xcode）。产物在 release/mac/Tideweave.app。
#   ./mac/build.sh          构建
#   ./mac/build.sh --run    构建后直接打开
#   SKIP_WEB_BUILD=1 ...    跳过 npm run build，直接用现有 dist/
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
cd "$root"

if [ "${SKIP_WEB_BUILD:-0}" != 1 ]; then npm run build; fi
[ -f dist/index.html ] || { echo "缺少 dist/index.html，请先 npm run build" >&2; exit 1; }

version="$(node -p "require('./package.json').version")"
cache="$here/build"
app="$root/release/mac/Tideweave.app"
mkdir -p "$cache"

# 存档在 ~/Library/Application Support/Tideweave，不在 .app 里，所以整个重建是安全的
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

swiftc -swift-version 5 -O \
  -target "$(uname -m)-apple-macos13.0" \
  -sdk "$(xcrun --show-sdk-path --sdk macosx)" \
  "$here"/Sources/*.swift \
  -o "$app/Contents/MacOS/Tideweave"

sed "s/__VERSION__/$version/g" "$here/Info.plist" > "$app/Contents/Info.plist"

# 图标只在源图变化时重新生成
icon_src="$root/assets/nodes/node_hub.png"
if [ ! -f "$cache/AppIcon.icns" ] || [ "$icon_src" -nt "$cache/AppIcon.icns" ] || [ "$here/make-icon.swift" -nt "$cache/AppIcon.icns" ]; then
  rm -rf "$cache/AppIcon.iconset"
  swift "$here/make-icon.swift" "$icon_src" "$cache/AppIcon.iconset"
  iconutil -c icns "$cache/AppIcon.iconset" -o "$cache/AppIcon.icns"
fi
cp "$cache/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"

cp -R dist "$app/Contents/Resources/dist"
for f in README.md THIRD_PARTY_NOTICES.md; do cp "$f" "$app/Contents/Resources/"; done

# ad-hoc 签名：本机和 Apple 芯片上运行所必需；没有开发者证书，不做公证
codesign --force --sign - "$app"

echo "已构建：$app"
if [ "${1:-}" = "--run" ]; then open "$app"; fi
