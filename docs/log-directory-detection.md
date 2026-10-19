# 游戏日志目录检测

本地检测的目标是找到可读取的 Broken Arrow `GameLogs`。检测只在用户点击“设置 → 游戏连接”中的“自动检测 Steam”时运行，成功结果通过设置的自动保存流程持久化，再改变监听目录，无须额外点击保存。

## 调研依据

调研日期：2026-10-15。以下为官方接口和成熟开源实现的做法；日志目录排序属于本项目的判断规则，并非 Steam 官方标准。

| 问题                     | 参考实践                                                                                                                                                                                           | 本项目处理                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Steam 装在自定义位置     | [Playnite 的 Steam 实现](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/SteamLibrary/Steam.cs)读取当前用户注册表的 `SteamPath`                                      | 优先读取 HKCU/HKLM 下 `Software\Valve\Steam` 的 `SteamPath` / `InstallPath`，常见路径仅作后备 |
| 注册表视图不同           | [Microsoft 文档](https://learn.microsoft.com/en-us/windows/win32/winprog64/accessing-an-alternate-registry-view)要求分别枚举 32 位和 64 位视图，避免直接依赖 `Wow6432Node`                         | 用 .NET RegistryView 显式读取两个视图，普通用户权限即可                                       |
| 多库和非默认游戏文件夹名 | [Playnite 本地库实现](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/SteamLibrary/Services/SteamLocalService.cs)解析 KeyValues 库配置、应用清单、安装状态和实际目录 | 解析 `libraryfolders.vdf` 与 `appmanifest_1604270.acf` 的 `appid`、`installdir`、`StateFlags` |
| 得到路径是否等于已安装   | [Steamworks GetAppInstallDir](https://partner.steamgames.com/doc/api/ISteamApps#GetAppInstallDir)即使应用未安装也可能返回默认预期目录                                                              | 检查目录是否可枚举，并实际打开候选游戏日志验证可读性                                          |
| 能否直接调用 Steamworks  | [SteamAPI_Init](https://partner.steamgames.com/doc/api/steam_api#SteamAPI_Init)需要 Steam 客户端和合适的 App ID / 许可上下文                                                                       | 此独立助手使用离线元数据发现，无需把 Steamworks SDK、登录或网络调用引入检测流程               |

## 检测流程

1. 通过无窗口、无配置文件的 PowerShell 子进程读取注册表。脚本固定，不拼接用户输入；UTF-8 JSON 保留中文路径。子进程有 4 秒超时和输出大小限制；失败后继续检查后备位置。
2. 使用系统 Program Files 环境变量、系统盘 `Steam` 和原有 D/E/F 盘路径作为后备。对 Windows 路径做大小写不敏感去重。
3. 读取已知 Steam 根目录下 `steamapps/libraryfolders.vdf`，兼容旧 `config/libraryfolders.vdf` 和旧数字键直接保存路径的格式。结构化解析支持注释、嵌套、BOM 和转义，不从注释或任意嵌套字段提取路径。
4. 按正式版 [Broken Arrow App ID 1604270](https://store.steampowered.com/app/1604270/Broken_Arrow/)读取清单，用真实 `installdir` 拼接目录。拒绝绝对路径、父目录跳转和路径分隔符。仍保留 `broken_arrow/GameLogs` 作为缺失清单时的兼容候选。
5. 只用 `Gamelog__*.log` / `Gamelog__*.txt` 常规文件作为日志证据，逐个处理文件被轮转、移除或不可读的情况。普通 `debug.log` 和目录修改时间不参与排序。没有日志的目录只有在正确 App ID 和 FullyInstalled 状态位确认后才可选，便于首次启动前配置。
6. 候选依次按“最近两分钟有日志写入”“清单确认已安装”“最新可读游戏日志的修改时间”降序选择。两分钟阈值与现有日志监听器一致。同等条件保持发现顺序，以获得稳定结果。

目录不存在、无权访问、配置损坏或外接库离线，不影响其他候选继续检测。整个流程只读取 Steam 元数据和日志，不修改 Steam、注册表或游戏文件，也不递归扫描磁盘。

## 设置交互

- Detection failures preserve the existing path and unsaved manual input, with retry, game startup, and manual selection guidance available in Chinese and English.
- 检测期间显示进度，禁止重复检测；仍可编辑路径、手动选择目录或返回原页面。
- 用户编辑或选择路径后，较晚返回的检测结果不会覆盖该操作；离开设置后也不应用旧检测结果。返回前会先保存用户已修改的路径。
- 成功结果自动保存后生效。手动输入在停止输入 500ms 后保存，失焦或返回时立即提交；目录选择立即保存。保存失败保留修改并提供重试，允许用户主动选择非标准目录。

## 边界与验证

`libraryfolders.vdf` / ACF 是 Steam 的本地实现格式，不是稳定公开接口；解析失败会降级，手动选择始终可用。最近修改时间只能表明日志近期变化，无法证明对应游戏进程正在运行；复制或触碰旧日志也可能影响排序。多份有效安装仍有歧义时，需核对检测结果，必要时手动指定目录。

检测只覆盖 Windows Steam 正式版。未注册且不在后备位置的便携 Steam、未声明的游戏库、其他发行渠道、测试版或外置自定义日志目录，需要手动选择。注册表子进程有超时，文件系统访问仍可能受 Windows 对离线网络路径的等待影响。

`tests/directories.test.ts` 使用真实隔离目录覆盖自定义根目录、多库、新旧格式、中文路径、清单目录名、安装状态、旧目录排序、空目录、损坏配置及非法路径；Windows 注册表子进程采用可控替身测试失败降级。`tests/ui.test.tsx` 验证检测失败、自动保存、重试、重复点击、手动输入/选择、返回时提交待保存输入，以及离开后的异步顺序。
