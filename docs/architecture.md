# 架构

职责划分参考 [T3 Code apps](https://github.com/pingdotgg/t3code/tree/main/apps)。

```text
apps/
  desktop/    Electron 窗口、preload、系统目录、验证、输入钩子、录制、视频协议
  server/     Node.js 业务、日志、HTTP 调度、分析、卡组、SQLite
  web/        React 功能模块、公共 UI、hooks、四语和主题
packages/
  contracts/  领域类型、Zod 请求验证、RPC 和事件协议
  shared/     归一化、合并、格式化、录像参数、蛆指数纯计算
tests/        算法、网络、生命周期、迁移、文件、录像、React
scripts/      开发、桌面冒烟、图标
```

server 是可注入平台接口的 Node 业务层，在 Electron 装配，不额外开放 HTTP 端口。真实 HTTP 使用 net.fetch，与验证窗口共享会话 cookie。web 不访问 Node、文件或 SQLite。

快照和事件共用类型及 revision；过期状态和副作用均被拒绝。查询有 requestId、context 和 generation；报告按目标 / 请求身份接收结果。蛆查全局互斥，订阅返回 cleanup。设置 draft 保存后立即应用统一状态。

SQLite 使用 WAL、外键、索引、prepared statements、事务。对局、名单和账号视角分表；删除不使用玩家名构造路径。缓存保留时间和 stale 标记。

日志读取 64 KiB、StringDecoder、逐批让出循环。历史恢复不触发过去的录像、输入统计和卡组备份；新鲜进行中会话可以从当前时点恢复。

日志支持新旧大厅和名单格式，跨批次保留原始时间戳与历史半行的来源。无 FID 对局按日志来源和开局位置生成稳定身份，重复恢复不会新增档案。延迟网络时长优先按连接或 FID 关联，无法区分的事件不写入新局。

历史档案使用独立 LogParser，启动、切换目录、每 30 秒及手动刷新时递归扫描所有 `.log` / `.txt`（不跟随符号链接），不会改变实时会话或触发录像、APM、卡组操作。按文件身份、大小和修改时间保存 SQLite 检查点，每份日志的对局与检查点在同一事务提交；未变化的文件跳过，失败可重试。保留无结束事件的记录，结束时间保持未知。删除记录保存日志排除标记，避免后续扫描复活。查询返回全部档案，前端每页 50 条并提供页码跳转。

玩家报告区分总场次、已知胜负样本和最近一场指标；未知胜负不进入胜率分母。蛆指数校验双方各五名唯一玩家，同分共享平均名次；重试失败也计入报告请求数。刷新贯通报告与调查，兜底档案同样刷新并保存快照。对局先保存近期列表再补全详情，较旧 API 数据只能补缺。自定义局仅依据明确胜方字段判胜负，不使用摧毁分猜测。

录制有独立 token、sender、sequence 和写盘队列；逐片等待确认，停止等待尾片与落盘。时长取真实经过时间。播放器用短期 token 和 Range，不整文件跨 IPC。

卡组 ZIP 校验路径、扩展名、CRC、边界和容量。压缩 / 解压使用异步线程池，写入临时文件后 rename，失败明确反馈。

公共 Button、Card、Dialog、Menu、Field、Toggle、Badge、Stats 集中交互规则；Radix Portal 管理浮层和键盘，Dialog 恢复焦点。样式分 tokens / base / components / layout。
