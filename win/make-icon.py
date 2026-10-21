#!/usr/bin/env python3
"""生成 Windows 版图标 win/Tideweave.ico（exe、安装包、快捷方式共用）。

来源是 Mac 版的图标（mac/make-icon.swift 用游戏里的「枢纽」节点图画的，在 mac/build/AppIcon.iconset/ 里，
先跑一次 npm run package:mac 生成）。Mac 图标按 macOS 规范四周留了约 10% 透明边（1024 画布里主体 824），
Windows 图标习惯铺满画布，所以先裁掉透明边再缩放。生成的 .ico 已提交，Windows 上打包不需要再跑这个脚本。

用法：python3 win/make-icon.py      依赖 Pillow
"""
from pathlib import Path

from PIL import Image

here = Path(__file__).resolve().parent
source = here.parent / "mac" / "build" / "AppIcon.iconset" / "icon_512x512@2x.png"
output = here / "Tideweave.ico"

image = Image.open(source).convert("RGBA")
image = image.crop(image.getbbox())  # 裁掉透明边
# Windows 资源管理器、任务栏、开始菜单、安装向导会用到的尺寸
image.save(output, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"已生成 {output}（{output.stat().st_size // 1024} KB）")
