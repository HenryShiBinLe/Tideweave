; 脉序 · Tideweave（Windows 同步版）安装包，用 Inno Setup 6 编译，产物是 Tideweave-Setup-<版本>.exe。
;
; 编译（在 Windows 上，先用 npm run package:win-sync 打出 release\win-sync\Tideweave-win32-x64\）：
;   ISCC.exe /DSourceDir=<Tideweave-win32-x64 目录> /DOutputDir=<输出目录> /DAppVersion=<版本> win\installer.iss
;
; 设计：
;   - 按当前用户安装到 %LOCALAPPDATA%\Programs\Tideweave，不需要管理员权限，不弹权限确认；
;   - 不让玩家改安装位置：放到网络共享或被重定向的文件夹（例如 Parallels 把桌面映射到 Mac）时，
;     Chromium 沙盒里的子进程启动不了，游戏一打开就闪退（10/21 在虚拟机里遇到过）；
;   - 存档在安装目录的 data\ 里（程序的规则：exe 旁边能写就写在旁边）。覆盖安装（升级）不动它，
;     卸载时也保留，重新安装后接着玩；
;   - 升级或卸载时，如果游戏开着，用 Windows 的重启管理器提示关闭。

#ifndef SourceDir
  #error 请用 /DSourceDir=<Tideweave-win32-x64 目录> 指定打包好的程序目录
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
; AppId 决定“是不是同一个程序”：升级、卸载都靠它，发布后不能再改
AppId={{D6E42587-5463-4375-9B38-DD06B1709EF1}
AppName=脉序 · Tideweave
AppVersion={#AppVersion}
AppVerName=脉序 · Tideweave {#AppVersion}
AppPublisher=Tideweave Project
VersionInfoVersion={#AppVersion}
VersionInfoDescription=脉序 · Tideweave 安装程序
PrivilegesRequired=lowest
DefaultDirName={autopf}\Tideweave
DisableDirPage=yes
DefaultGroupName=脉序 · Tideweave
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
SetupIconFile=Tideweave.ico
UninstallDisplayIcon={app}\Tideweave.exe
UninstallDisplayName=脉序 · Tideweave
CloseApplications=yes
RestartApplications=no
Compression=lzma2/max
SolidCompression=yes
OutputDir={#OutputDir}
OutputBaseFilename=Tideweave-Setup-{#AppVersion}

[Languages]
; 简体中文是 Inno Setup 的社区翻译，不随编译器附带。这里用的是官方仓库 is-6_7_3 标签下
; Files/Languages/Unofficial/ChineseSimplified.isl（维护者 Zhenghan Yang），只在开头加了 UTF-8 BOM，内容未改
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "快捷方式："

[Files]
; 打包目录里如果有 data\（有人在里面运行过），不要把那份存档装给玩家
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "\data,\data\*"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\脉序 · Tideweave"; Filename: "{app}\Tideweave.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\脉序 · Tideweave"; Filename: "{app}\Tideweave.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Tideweave.exe"; Description: "立即开始游戏"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Messages]
; 卸载完成时说明存档还在
chinesesimplified.UninstallStatusLabel=正在卸载 %1。游戏进度会保留，重新安装后可以接着玩。

[Code]
// 升级（覆盖安装）和卸载之前，先关掉从本安装目录启动的游戏。10/21 虚拟机实测：
//   - 卸载：Inno Setup 的卸载程序不会去关正在运行的程序，游戏开着时卸载会留下删不掉的 exe、dll、app.asar，
//     而“应用和功能”里的条目已经没了；
//   - 升级：CloseApplications（重启管理器）本该关掉游戏，但它同时发现系统服务 XtaCache（ARM 版 Windows 转译 x64 程序的缓存）
//     也打开了这些文件，按当前用户安装没有权限关它，于是整个放弃重启管理器，替换 d3dcompiler_47.dll 时“拒绝访问”，安装回滚。
//     游戏关掉后 XtaCache 不妨碍替换和删除文件。
// 做法：先给游戏窗口发 WM_CLOSE，游戏照常走“先存档、再推送”的退出流程；6 秒内没退出再强制结束。
// 游戏每步操作都会自动存档，强制结束最多丢掉还没推到云端的最后一点改动，下次启动会补推。
const
  WM_CLOSE = $0010;
  GameWindowTitle = '脉序 · Tideweave';

// 从本安装目录启动的游戏进程（主进程和它的 GPU、渲染等子进程都是同一个 exe）
function GameProcesses(): Variant;
var
  Locator, Service: Variant;
  Path: String;
begin
  Path := ExpandConstant('{app}\Tideweave.exe');
  StringChangeEx(Path, '\', '\\', True);
  StringChangeEx(Path, '''', '\''', True);
  Locator := CreateOleObject('WbemScripting.SWbemLocator');
  Service := Locator.ConnectServer('.', 'root\CIMV2');
  Result := Service.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE ExecutablePath = ''' + Path + '''');
end;

function GameRunning(): Boolean;
begin
  try
    Result := GameProcesses().Count > 0;
  except
    Result := False; // 查不了进程（WMI 不可用）时不拦着卸载
  end;
end;

procedure CloseGame();
var
  Wnd: HWND;
  Items: Variant;
  I, ResultCode: Integer;
begin
  Wnd := FindWindowByWindowName(GameWindowTitle);
  if Wnd <> 0 then PostMessage(Wnd, WM_CLOSE, 0, 0);
  for I := 1 to 30 do
  begin
    if not GameRunning() then Exit;
    Sleep(200);
  end;
  try
    Items := GameProcesses();
    for I := 0 to Items.Count - 1 do
      Exec('taskkill.exe', '/F /PID ' + IntToStr(Items.ItemIndex(I).ProcessId), '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  except
  end;
  Sleep(1000);
end;

const
  CloseQuestion = '脉序 · Tideweave 正在运行。' + #13#10#13#10 + '点“是”关闭游戏并继续%s（游戏进度会保留）；点“否”取消%s。';

// 升级：在替换文件之前关掉游戏。返回非空字符串时安装停止，并显示这段话
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  while GameRunning() do
  begin
    if not WizardSilent() then
      if MsgBox(Format(CloseQuestion, ['安装', '安装']), mbConfirmation, MB_YESNO) <> IDYES then
      begin
        Result := '游戏还在运行，安装已取消。关闭游戏后重新运行安装程序即可。';
        Exit;
      end;
    CloseGame();
    if WizardSilent() then Exit;
  end;
end;

// 卸载：同样先关掉游戏
function InitializeUninstall(): Boolean;
begin
  Result := True;
  while GameRunning() do
  begin
    if not UninstallSilent() then
      if MsgBox(Format(CloseQuestion, ['卸载', '卸载']), mbConfirmation, MB_YESNO) <> IDYES then
      begin
        Result := False;
        Exit;
      end;
    CloseGame();
    if UninstallSilent() then Exit;
  end;
end;
