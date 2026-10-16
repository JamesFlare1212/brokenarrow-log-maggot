# 断箭蛆工具 · v4

本地 Broken Arrow 对局助手，使用 React + Vite + Electron + Node.js + TypeScript + SQLite，以及 pnpm。

[视觉规范](design-system/broken-arrow/MASTER.md) · [架构](docs/architecture.md) · [数据迁移](docs/migration.md) · [审查问题处理](docs/audit-resolution.md)

[游戏日志目录检测：实现与调研依据](docs/log-directory-detection.md)

## 功能

- GameLogs 增量监听：房间、队伍、地图、账号、卡组、晚到的对局 ID 和真实时长。
- 总览保留房间与对局工具，侧栏「蛐雷达」提供独立入口；封禁列表在「封禁追踪」页面查看。
- 玩家搜索、粗查报告、最近对局、12 场 MVP 蛆指数、调查羁绊和改名历史。
- 对局档案、完整评分、手动收录、刷新、删除和多个录像视角。
- 卡组备份 / 部署、实时开局自动覆盖唯一的“上一局卡组包”、换号提醒。
- 本地录像：240–1080p、30–60 fps、3–10 Mbps、系统声音与默认麦克风混音、预览、播放和目录迁移。
- 可选真实输入 APM、封禁提醒。
- 跟随系统 / 浅色 / 深色三种主题模式，六组配色，浅深配色分别记忆；四种界面语言。
- 独立设置页面、自动保存、返回原页面，以及可折叠并记住状态的侧栏。

BATrace 是历史数据，可能延迟数天。蛆指数需要最近 12 场有效五人队排位；缺本人、完整 MVP 或足够样本时不生成替代分数。

## 开发

安装 Node.js 24 LTS 与 pnpm 10.34.6（最低 Node.js 22.16）：

```sh
pnpm install
pnpm dev
```

Electron 44 的运行时由 postinstall 显式安装。开发启动器先构建，再启动 Vite 和 Electron。

仅在浏览器中开发前端时运行：

```sh
pnpm dev:web
```

打开终端显示的 `http://127.0.0.1:5174/`，支持 Vite 热更新，无需启动 Electron。页面通过仅在此开发模式启用的本地接口加载 `tests/fixtures/real` 的真实测试数据；每次启动在 `.test-data/web-dev/` 创建独立副本。查询只使用已录制的离线响应，缺失时显示错误。页面设置和数据修改只影响本次副本；本机目录选择、录屏、输入钩子和安装更新等桌面功能不可用。

| 命令                | 用途                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `pnpm dev`          | 使用仓库内真实样本启动离线桌面开发；每次创建隔离数据库            |
| `pnpm dev:web`      | 浏览器前端开发，加载同一批真实测试样本，支持热更新，默认端口 5174 |
| `pnpm data:import`  | 从本机应用数据库和 GameLogs 更新真实回归样本                      |
| `pnpm test`         | 全部回归测试，默认包含仓库内的真实日志、档案和缓存数据            |
| `pnpm smoke:real`   | 构建并在真实 Electron 中核对全部真实档案                          |
| `pnpm check`        | 严格类型检查、回归测试、三个应用构建                              |
| `pnpm smoke`        | 隔离数据目录的真实 Electron 冒烟；不联网、录屏或开输入钩子        |
| `pnpm format:check` | 格式检查                                                          |
| `pnpm pack:desktop` | Windows 解包目录                                                  |
| `pnpm dist`         | NSIS 安装包与便携版                                               |

生产前端通过 sandboxed preload 的类型化 IPC 访问服务。`pnpm dev` 同时启动 Vite 和 Electron，通过原生服务加载真实样本的隔离副本；其 5173 端口在普通浏览器中访问 `/` 会提示使用桌面应用。`pnpm dev:web` 在 5174 端口为浏览器提供真实测试样本接口，不访问本机应用数据库。

仓库已包含 258 份本地日志提取的 454 场真实对局，以及 13 场 API 档案、600 名玩家和 28 份缓存响应，压缩后约 301 KB。`pnpm dev` 使用这些固定样本，每次在 `.test-data/real-dev/` 新建可写副本，保留真实名字、ID 和评分。开发时离线运行，默认关闭录像和输入钩子；日志、卡组和录像目录均指向隔离副本。真实数据回归包含在 `pnpm test` / `pnpm check` 中；CI 额外执行真实数据桌面冒烟。来源校验、提取范围与重新导入方式见 [真实样本说明](tests/fixtures/real/README.md)。

## 应用更新与发布

Windows 正式版启动 15 秒后检查 GitHub Releases，此后每 4 分钟检查。设置和“关于”页面均有更新入口；下载和重启安装由用户主动操作，普通退出不会自动安装。安装前关闭后台任务、保存录像并关闭 SQLite；对局或录制进行中不能重启安装。更新失败可重试或打开下载页面，上次安装未生效会显示提示。

NSIS 安装版支持应用内下载、校验、差分下载和重启安装。便携版仅检查并提示新版本，需退出后手动替换 EXE。桌面开发、浏览器开发、冒烟运行不检查更新；`BA_DISABLE_AUTO_UPDATE=1` 可关闭正式版更新。

发布稳定版时，将根 `package.json` 版本更新为 `X.Y.Z`，提交后推送一致的 `vX.Y.Z` 标签。CI 校验标签、测试、打包，并将安装版、便携版、`latest.yml` 和 `.blockmap` 发布至 GitHub Releases。不要只上传 EXE；更新清单必须指向 `BrokenArrow-Setup-…exe`。`node scripts/verify-update-artifacts.mjs` 可校验产物及安装包 SHA-512。手动运行工作流只生成构建产物，不发布 Release。

尚未包含更新器的旧版本需要手动安装一次新版。首次正式发布后，还应在隔离的 Windows 用户环境中从较旧的安装版升级到更高版本，验证真实下载、NSIS 安装和重启；本地冒烟不会替换已安装的应用。

## 请求与数据

BATrace 请求统一排队，默认间隔至少 1200ms；缓存命中不发送请求，手动刷新绕过缓存。

数据保存在原 `broken-arrow-log-assistant` 用户目录中的 SQLite。旧 JSON 在首次启动备份并事务导入，原文件保留。录像仍是本地 WebM，播放通过受控 Range 协议按需读取。

APM 和录像默认关闭。APM 仅统计进行中对局、游戏在前台时的真实输入；录像捕获所选显示器完整画面。

## English

A local Broken Arrow assistant: match analysis, player history, deck backups, recordings, optional real-input APM, three appearance modes, six palette pairs and four languages. Run `pnpm install` and `pnpm dev`; validate with `pnpm check`. Existing JSON is backed up and imported transactionally into SQLite without changing the original files. Recordings remain local and use range-based playback. BATrace data can be delayed.

## 日本語

Broken Arrow のローカル対局アシスタントです。対局分析、履歴、デッキ、録画、任意の実入力 APM、3 種の外観モード、6 組の配色、4 言語を備えます。`pnpm install` と `pnpm dev` で起動します。旧 JSON はバックアップ後に SQLite へ移行し、元ファイルを残します。

## Русский

Локальный помощник Broken Arrow: анализ матчей, история, колоды, записи, опциональный APM, 3 режима оформления, 6 цветовых пар и 4 языка. Запуск: `pnpm install`, затем `pnpm dev`. Старые JSON сохраняются и импортируются в SQLite транзакцией. Записи остаются локальными.

## 致谢与参考

作者 Zola；数据由 [BATrace](https://dash.batrace.top/) 提供。应用职责划分参考 [T3 Code apps](https://github.com/pingdotgg/t3code/tree/main/apps)，未复制其业务代码。旧入口保留在 Git 历史中。
