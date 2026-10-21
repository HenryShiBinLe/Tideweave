#!/bin/bash
# 制作 Mac 版安装镜像：release/mac/Tideweave-<版本>.dmg
# 镜像里放 Tideweave.app、“应用程序”文件夹的替身（拖进去即安装）和首次打开说明。
#   ./mac/make-dmg.sh             先构建 App（mac/build.sh），再做镜像
#   SKIP_APP_BUILD=1 ./mac/make-dmg.sh   直接用现有的 release/mac/Tideweave.app
# App 只有 ad-hoc 签名，没有苹果开发者签名和公证：从网上下载后第一次打开会被系统拦住，
# 要到“系统设置 → 隐私与安全性”点“仍要打开”，做法写在镜像里的说明中。
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
cd "$root"

if [ "${SKIP_APP_BUILD:-0}" != 1 ]; then bash "$here/build.sh"; fi
app="$root/release/mac/Tideweave.app"
[ -d "$app" ] || { echo "缺少 $app，请先 npm run package:mac" >&2; exit 1; }
codesign --verify --deep --strict "$app"

version="$(node -p "require('./package.json').version")"
dmg="$root/release/mac/Tideweave-$version.dmg"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

ditto "$app" "$stage/Tideweave.app"
ln -s /Applications "$stage/应用程序"
cp "$here/首次打开说明.txt" "$stage/"

rm -f "$dmg"
hdiutil create -volname "脉序 Tideweave" -srcfolder "$stage" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$dmg" >/dev/null
hdiutil verify "$dmg" >/dev/null
echo "已生成：$dmg（$(du -h "$dmg" | cut -f1)）"
