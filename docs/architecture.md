# 架构

职责划分参考 [T3 Code apps](https://github.com/pingdotgg/t3code/tree/main/apps)。

```text
apps/
  desktop/    Electron windows, preload, system paths, verification, recording, video protocol
  server/     Node.js 业务、日志、HTTP 调度、分析、卡组、SQLite
  web/        React 功能模块、公共 UI、hooks、四语和主题
packages/
  contracts/  领域类型、Zod 请求验证、RPC 和事件协议
  shared/     归一化、合并、格式化、录像参数、蛆指数纯计算
tests/        算法、网络、生命周期、迁移、文件、录像、React
scripts/      开发、桌面冒烟、图标
```

server 是可注入平台接口的 Node 业务层，在 Electron 装配，不额外开放 HTTP 端口。真实 HTTP 使用 net.fetch，与验证窗口共享会话 cookie。web 不访问 Node、文件或 SQLite。

快照和事件共用类型及 revision；过期状态和副作用均被拒绝。查询有 requestId、context 和 generation；报告按目标 / 请求身份接收结果。蛆查全局互斥，订阅返回 cleanup。设置使用独立页面与共享的自动保存队列：本地修改即时反映，按变更字段串行持久化，较旧响应不覆盖新输入，保存失败保留修改并可重试。主题模式与浅色、深色配色分别存储，选择配色不切换模式。

SQLite 使用 WAL、外键、索引、prepared statements、事务。对局、名单和账号视角分表；删除不使用玩家名构造路径。缓存保留时间和 stale 标记。

Each database connection reuses its prepared statements and releases them on close.
Encounter queries load match payloads and account views in batches, preserving each
account's outcome while avoiding repeated reads of the same match. Legacy encounter
deduplication uses a set of match IDs.

Log reads use 64 KiB chunks and StringDecoder, yielding between batches. Historical
recovery does not trigger recordings or deck backups for past matches; a fresh
active session can resume from the current point.

日志支持新旧大厅和名单格式，跨批次保留原始时间戳与历史半行的来源。无 FID 对局按日志来源和开局位置生成稳定身份，重复恢复不会新增档案。延迟网络时长优先按连接或 FID 关联，无法区分的事件不写入新局。

Historical archives use a separate LogParser and recursively scan `.log` and `.txt` files at startup, after directory changes, every 30 seconds, and on manual refresh. Scans do not follow symbolic links or change the live session, recording, or deck state. SQLite checkpoints track file identity, size, and modification time; matches and checkpoints commit in one transaction. Unchanged files are skipped and failed scans can retry. Matches without end events keep an unknown end time. Deletion markers prevent rescans from restoring removed matches. Queries return the full archive, with 50 matches per page and page navigation in the UI.

Database startup removes retired input-statistics tables and the obsolete collection setting. Saved navigation filters retired pages while preserving other preferences.

玩家报告区分总场次、已知胜负样本和最近一场指标；未知胜负不进入胜率分母。蛆指数校验双方各五名唯一玩家，同分共享平均名次；重试失败也计入报告请求数。刷新贯通报告与调查，兜底档案同样刷新并保存快照。对局先保存近期列表再补全详情，较旧 API 数据只能补缺。自定义局仅依据明确胜方字段判胜负，不使用摧毁分猜测。

录制有独立 token、sender、sequence 和写盘队列；逐片等待确认，停止等待尾片与落盘。时长取真实经过时间。播放器用短期 token 和 Range，不整文件跨 IPC。

The recording controller allocates a capture token before display discovery and
keeps that session identity throughout startup, recording, and stopping. Recording
the same match again allocates a different token, so IPC from an earlier capture
cannot affect the new recording. Disabling recording during display discovery
cancels startup; disabling an active recording waits for the final file.

Player reports expose a separate `ratingTrend` of up to 30 chronological analysis
points, retaining each match ID, end time, and pre/post-match rating. The existing
12-row recent-match table keeps its newest-first order. Both views use the same
analysis response without additional network calls. Missing ratings remain null;
fallback player summaries supply an empty trend. The player detail chart measures
the displayed period from the first pre-match rating to the last post-match rating
and never reconstructs history from the current rating or partial deltas.

卡组 ZIP 校验路径、扩展名、CRC、边界和容量。压缩 / 解压使用异步线程池，写入临时文件后 rename，失败明确反馈。

Manual deck backups stage the complete archive and never overwrite an existing
backup. Create-only writes prefer a hard link and fall back to an exclusive file
copy when hard links are unsupported. The copy fallback preserves collision
protection but does not guarantee atomic visibility while bytes are copied.
Staging files are removed after success or failure, and genuine access-denied
errors remain errors. The managed previous-match archive intentionally replaces
its prior version through a rename, as do deck restores.

Shared shadcn primitives and the application Button, Card, Dialog, Menu, Field,
Toggle, Badge, and Stats wrappers centralize interaction rules. Radix manages
portals, keyboard behavior, and dialog focus restoration. Theme and glass tokens
live in `apps/web/src/styles/index.css`; layout, scrollbars, and responsive rules
live in `apps/web/src/styles/layout.css`. Card and full-size card choices share
`cardSurfaceClasses` rather than copying surface styles into feature pages. See
the [UI design system](../design-system/broken-arrow/MASTER.md) and
[component audit](ui-audit.md) for the current rules and deliberate exceptions.

Match archive details use `#archive/match/{fid}` within the existing workspace.
The mounted archive retains its account/result filters, sorted row model,
pagination, and scroll state while details are visible. Explicit row/card buttons
provide keyboard access; noninteractive row clicks open the same page. Browser
Back and the detail back action restore the initiating control. Previous/next
uses the filtered, sorted sequence before pagination and replaces the detail
history entry. Contextual match dialogs reuse the same detail component.

Match statistics are grouped into core, combat, and support tables. Player
disclosures retain all metrics and award evidence. Match and recording requests
settle independently; refresh errors preserve cached content and the active tab.
Local team membership comes from the player ID, outcomes come from recorded
results, and incomplete team totals remain unavailable. No new backend schema
or statistical inference is introduced by the layout.

## Optional anonymous analytics

The main process sends explicit Aptabase events after the user saves an enabled
analytics choice. Collection includes startup/first-open/version observations,
live match starts, selected feature results and durations, classified errors,
update outcomes, and foreground-active performance samples.

`analyticsEnabled` defaults to false; `analyticsChoiceSaved` records the consent
dialog decision. Development, fixtures, smoke tests, offline mode, and
`BA_DISABLE_ANALYTICS=1` disable collection.

A random session exists only in memory and rotates after an idle hour, clock
rollback, UTC date change, restart, or opt-out. Game-account detection is independent
of analytics. App/OS versions and locale use Aptabase system properties; event
dimensions contain explicit feature names, results, durations, and public code positions.

At most 200 events queue in memory for five minutes, with three delivery attempts
and 20 events per request. Opt-out cancels requests and empties the queue. Shutdown
allows a bounded flush and discards the remainder. Resource samples require
foreground activity; long-task aggregates are also cleared on blur/hide.

Local app-version markers and pending update versions/stage support first-open,
version-change, and update-outcome events. `analytics:appVersion` and
`analytics:pendingUpdate` contain no session or user identifier. The update store
exposes only `load()` and `save()`.

See [anonymous analytics](analytics.md) for event definitions and counting limits.

## Temporary QUIC workaround

Added on 2026-10-16: the Electron main process calls
`app.commandLine.appendSwitch('disable-quic')` before the app becomes ready. This is a
temporary mitigation for observed BATrace HTTP/3 requests stalling after the QUIC
handshake, not a confirmed fix for the underlying network or Chromium issue. See
[Cloudflare's HTTP/3 troubleshooting guidance](https://developers.cloudflare.com/speed/optimization/protocol/troubleshooting/protocol-troubleshooting/#chrome-stalls-or-fails-only-on-http3).

The switch disables QUIC/HTTP/3 throughout the desktop application's Chromium network
sessions, including `net.fetch`. HTTPS continues over HTTP/2 or HTTP/1.1 with normal
DNS resolution, proxy handling and certificate validation. Request scheduling,
retries and health-check timing are separate concerns.

Revisit this workaround after Electron/Chromium updates or a confirmed network fix.
Remove the startup switch only after repeated BATrace requests succeed over verified
HTTP/3 using normal DNS, with the VPN both enabled and disabled. Capture a Chromium
NetLog to confirm HTTP/3 response headers arrive rather than silently falling back
to TCP, and compare against a TCP baseline. Run `pnpm check`, `pnpm format:check`,
`pnpm smoke` and `pnpm smoke:real` when removing the workaround.
