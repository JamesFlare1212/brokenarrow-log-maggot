# 断箭蛆工具 byZola · v4

本地 Broken Arrow 对局助手，使用 React + Vite + Electron + Node.js + TypeScript + SQLite，以及 pnpm。

[中文使用说明](使用说明.md) · [架构](docs/architecture.md) · [数据迁移](docs/migration.md) · [审查问题处理](docs/audit-resolution.md)

## 功能

- GameLogs 增量监听：房间、队伍、地图、账号、卡组、晚到的对局 ID 和真实时长。
- 玩家搜索、粗查报告、最近对局、12 场 MVP 蛆指数、调查羁绊和改名历史。
- 对局档案、完整评分、手动收录、刷新、删除和多个录像视角。
- 卡组备份 / 部署、实时开局自动覆盖唯一的“上一局卡组包”、换号提醒。
- 本地录像：240–1080p、30–60 fps、3–10 Mbps、系统声音与默认麦克风混音、预览、播放和目录迁移。
- 可选真实输入 APM、封禁提醒。
- 七套主题、四种界面语言、保存面板顺序和折叠状态。

BATrace 是历史数据，可能延迟数天。蛆指数需要最近 12 场有效五人队排位；缺本人、完整 MVP 或足够样本时不生成替代分数。

## 开发

安装 Node.js 24 LTS 与 pnpm 10.34.6（最低 Node.js 22.16）：

```sh
pnpm install
pnpm dev
```

Electron 44 的运行时由 postinstall 显式安装。开发启动器先构建，再启动 Vite 和 Electron。

| 命令                | 用途                                                       |
| ------------------- | ---------------------------------------------------------- |
| `pnpm dev:web`      | 前端开发服务器；`/?demo` 是明确标识的内存演示              |
| `pnpm check`        | 严格类型检查、回归测试、三个应用构建                       |
| `pnpm smoke`        | 隔离数据目录的真实 Electron 冒烟；不联网、录屏或开输入钩子 |
| `pnpm format:check` | 格式检查                                                   |
| `pnpm pack:desktop` | Windows 解包目录                                           |
| `pnpm dist`         | NSIS 安装包与便携版                                        |

生产前端通过 sandboxed preload 的类型化 IPC 访问服务；普通浏览器不访问本地数据，也不自动开启演示。

## 应用更新与发布

Windows 正式版启动 15 秒后检查 GitHub Releases，此后每 4 分钟检查。设置和“关于”页面均有更新入口；下载和重启安装由用户主动操作，普通退出不会自动安装。安装前关闭后台任务、保存录像并关闭 SQLite；对局或录制进行中不能重启安装。更新失败可重试或打开下载页面，上次安装未生效会显示提示。

NSIS 安装版支持应用内下载、校验、差分下载和重启安装。便携版仅检查并提示新版本，需退出后手动替换 EXE。开发、网页演示、冒烟运行不检查更新；`BA_DISABLE_AUTO_UPDATE=1` 可关闭正式版更新。

发布稳定版时，将根 `package.json` 版本更新为 `X.Y.Z`，提交后推送一致的 `vX.Y.Z` 标签。CI 校验标签、测试、打包，并将安装版、便携版、`latest.yml` 和 `.blockmap` 发布至 GitHub Releases。不要只上传 EXE；更新清单必须指向 `BrokenArrow-Setup-…exe`。`node scripts/verify-update-artifacts.mjs` 可校验产物及安装包 SHA-512。手动运行工作流只生成构建产物，不发布 Release。

尚未包含更新器的旧版本需要手动安装一次新版。首次正式发布后，还应在隔离的 Windows 用户环境中从较旧的安装版升级到更高版本，验证真实下载、NSIS 安装和重启；本地冒烟不会替换已安装的应用。

## 请求与数据

所有实际 BATrace 内容请求尝试，包括后台同步和重试，计入滚动 24 小时 400 次额度。缓存命中不计，健康探测独立。请求统一排队，默认间隔至少 1200ms；手动刷新绕过缓存。

数据保存在原 `broken-arrow-log-assistant` 用户目录中的 SQLite。旧 JSON 在首次启动备份并事务导入，原文件保留。录像仍是本地 WebM，播放通过受控 Range 协议按需读取。

APM 和录像默认关闭。APM 仅统计进行中对局、游戏在前台时的真实输入；录像捕获所选显示器完整画面。

## English

A local Broken Arrow assistant: match analysis, player history, deck backups, recordings, optional real-input APM, seven themes and four languages. Run `pnpm install` and `pnpm dev`; validate with `pnpm check`. Existing JSON is backed up and imported transactionally into SQLite without changing the original files. Recordings remain local and use range-based playback. BATrace data can be delayed.

## 日本語

Broken Arrow のローカル対局アシスタントです。対局分析、履歴、デッキ、録画、任意の実入力 APM、7 テーマ、4 言語を備えます。`pnpm install` と `pnpm dev` で起動します。旧 JSON はバックアップ後に SQLite へ移行し、元ファイルを残します。

## Русский

Локальный помощник Broken Arrow: анализ матчей, история, колоды, записи, опциональный APM, 7 тем и 4 языка. Запуск: `pnpm install`, затем `pnpm dev`. Старые JSON сохраняются и импортируются в SQLite транзакцией. Записи остаются локальными.

## 致谢与参考

作者 Zola；数据由 [BATrace](https://app.batrace.top/) 提供。应用职责划分参考 [T3 Code apps](https://github.com/pingdotgg/t3code/tree/main/apps)，未复制其业务代码。旧入口保留在 Git 历史中。
