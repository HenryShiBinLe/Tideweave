# 安装包全流程测试（按当前用户运行，不需要管理员）。路径按 Parallels 共享文件夹 Z:（= Mac 的用户目录）写的，见 desktop/README.md。
#   安装 → 启动写记号 A → 游戏开着时写记号 B 并覆盖安装 → 读记号 → 游戏开着时写记号 C 并卸载 → 重装读记号
$ErrorActionPreference = 'Continue'
$setup = 'Z:\vibe1024\release\windows\installer\Tideweave-Setup-0.1.0.exe'
$probe = 'Z:\vibe1024\desktop\vm-test\probe.cjs'
$app = Join-Path $env:LOCALAPPDATA 'Programs\Tideweave'
$exe = Join-Path $app 'Tideweave.exe'
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\脉序 · Tideweave.lnk'
$desk = Join-Path ([Environment]::GetFolderPath('Desktop')) '脉序 · Tideweave.lnk'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{D6E42587-5463-4375-9B38-DD06B1709EF1}_is1'
$res = Join-Path $env:TEMP 'tw-probe.json'

# 不用 Start-Process -Wait：它会连游戏（探针的子进程）一起等，“保持游戏开着”那一步会一直卡住
function Probe($mode, $mark) {
  Remove-Item $res -ErrorAction SilentlyContinue
  $env:ELECTRON_RUN_AS_NODE = '1'
  Start-Process -FilePath $exe -ArgumentList $probe, "`"$app`"", $mode, $mark, "`"$res`"" -WindowStyle Hidden
  Remove-Item Env:ELECTRON_RUN_AS_NODE
  for ($i = 0; $i -lt 120 -and -not (Test-Path $res); $i++) { Start-Sleep -Milliseconds 500 }
  Start-Sleep -Milliseconds 300
  if (Test-Path $res) { "  探针：" + [IO.File]::ReadAllText($res, [Text.Encoding]::UTF8) } else { '  探针：60 秒没有结果' }
}
function GameCount { @(Get-CimInstance Win32_Process -Filter "name='Tideweave.exe'" | Where-Object { $_.ExecutablePath -eq $exe }).Count }
function State($label) {
  "  [$label] 程序：" + (Test-Path $exe) + "  开始菜单：" + (Test-Path $menu) + "  桌面：" + (Test-Path $desk) + "  卸载信息：" + (Test-Path $key) + "  data：" + (Test-Path (Join-Path $app 'data')) + "  游戏进程：" + (GameCount)
}
function RunSetup($label) {
  $t = Get-Date
  $p = Start-Process -FilePath $setup -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/LOG=`"$env:TEMP\tw-setup-$label.log`"" -PassThru -Wait
  "  [$label] 退出码：" + $p.ExitCode + "  用时 " + [int]((Get-Date) - $t).TotalSeconds + " 秒"
}

"== 0. 清理上一轮的残留 =="
Get-CimInstance Win32_Process -Filter "name='Tideweave.exe'" | Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
Remove-Item $menu, $desk -ErrorAction SilentlyContinue
State '清理后'

"== 1. 全新安装 =="
RunSetup '安装'
State '安装后'
$k = Get-ItemProperty $key -ErrorAction SilentlyContinue
"  应用和功能：" + $k.DisplayName + " / " + $k.DisplayVersion + " / " + $k.Publisher + " / 图标 " + $k.DisplayIcon

"== 2. 启动游戏，写记号 A，正常退出 =="
Probe 'set' 'A'

"== 3. 游戏开着（写记号 B）时覆盖安装 =="
Probe 'launch' 'B'
"  升级前游戏进程：" + (GameCount)
RunSetup '升级'
"  升级后游戏进程：" + (GameCount)
Select-String -Path "$env:TEMP\tw-setup-升级.log" -Pattern 'Restart Manager|RestartManager|Closing|关闭' -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object { "  安装日志：" + ($_.Line -replace '^\S+ \S+\s+','') }
State '升级后'
Probe 'get' '-'

"== 4. 游戏开着（写记号 C）时卸载 =="
Probe 'launch' 'C'
"  卸载前游戏进程：" + (GameCount)
$un = Join-Path $app 'unins000.exe'
$t = Get-Date
$p = Start-Process -FilePath $un -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -PassThru -Wait
for ($i = 0; $i -lt 40 -and (Test-Path $un); $i++) { Start-Sleep -Milliseconds 500 }
"  [卸载] 退出码：" + $p.ExitCode + "  用时 " + [int]((Get-Date) - $t).TotalSeconds + " 秒"
State '卸载后'
"  安装目录里剩下：" + ((Get-ChildItem $app -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ', ')

"== 5. 重新安装，读记号（应有 A、B、C）=="
RunSetup '重装'
State '重装后'
Probe 'get' '-'
