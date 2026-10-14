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

录制有独立 token、sender、sequence 和写盘队列；逐片等待确认，停止等待尾片与落盘。时长取真实经过时间。播放器用短期 token 和 Range，不整文件跨 IPC。

卡组 ZIP 校验路径、扩展名、CRC、边界和容量。压缩 / 解压使用异步线程池，写入临时文件后 rename，失败明确反馈。

公共 Button、Card、Dialog、Menu、Field、Toggle、Badge、Stats 集中交互规则；Radix Portal 管理浮层和键盘，Dialog 恢复焦点。样式分 tokens / base / components / layout。
