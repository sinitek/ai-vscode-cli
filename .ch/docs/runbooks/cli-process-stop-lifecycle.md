# CLI 停止请求、真实排空与清理边界

适用实现：`src/cli/cliProcessRuntime.ts`、`src/cli/processTermination.ts`、`src/cli/processLifecycle.ts`。

## 停止控制

`runCliProcess` 和 `captureCliProcessOutput` 在 spawn 返回后立即为原 `ChildProcess` 创建停止控制器，再接入 stdin、输出或调用方回调。状态只跟随该对象，不建立按 PID 查询或恢复的登记表。公开 launch、handle、output 签名和环境覆盖顺序保持原合同。

- POSIX 的第一次默认停止发送进程组 SIGTERM；组发送失败时回退到原 child。若原 child 尚无终态通知，最多在 2000ms 后升级一次 SIGKILL，仍使用组发送及原 child 回退。
- 重复 SIGTERM 不重复发送、不累积 timer，也不延后第一次停止的升级期限。显式 SIGKILL（或信号编号 9）取消待升级 timer，至多派发一次强停请求。其它信号保留原组发送语义。
- Windows 保持 `taskkill /PID <原pid> /T /F` 的树停止语义，同一控制器至多派发一次；不另建 POSIX 升级 timer。taskkill 的异步失败被消费，但不产生清理成功结论。
- 原 child 的真实 close 会取消待升级 timer，后续任意 kill 返回 false，不再向 PID、group 或 taskkill 派发。即使已取消的回调已排队，执行时仍须检查原对象的终态。
- 原 child 已 exit 时也停止向该旧标识派发；此时继承 stdio 的后代可能仍存在，排空和后代状态保持各自的未知边界。禁止为了补齐清理结论，在等待 close 时向旧 group 补发迟到信号。
- 无 PID 的 spawn 失败不派发信号，不安排升级；close 后释放终态观察监听。已 spawn 后的 error 可能来自 IPC 或信号请求，不单独视为终态。

timer 只有一个且会 unref；没有循环探测、重试 timer 或 PID 存在性轮询。kill 的布尔返回只表示停止请求端口的处理结果（运行中重复请求可复用已有请求），不表示进程、后代或 Owner 已清理。信号发送失败也不伪造成功事实。

## 真实证据合同

`processLifecycle` 仍独立观察真实事件：只有观察到原 child 的 spawn、close，才能确认该进程终态；只有被持有的 stdio 都实际结束并关闭且没有流错误，才能确认排空。exit、child.killed、信号请求成功、PID 存在、停止 timer 到期、capture 的超时拒绝，都不能替代这些证据。

`runCliProcess` 的 lifecycle 继续保留 `processTerminal`、`streams` 和真实 overlay cleanup 结果；输出与 onExit/onError 回调保持原入口。capture 超时仍先提出停止请求并拒绝调用方 Promise，原 child 的后续 close 会取消尚未执行的升级，但超时拒绝本身不等于清理完成。

进程终态、stdio 排空、临时目录清理、后代树终止、runner/session 释放和完整 Owner 清理是不同事实。本控制器不提供后代树或完整 Owner 的确认。后代无法证明时保持未知，由既有 Owner 门禁继续处理，不用信号请求成功释放容量或补写清理证据。

## 最小验证

按 `.ch/docs/TESTING.md` 使用独立实体 `src/` 和 `dist/` 的临时副本，复制 package.json、tsconfig.json，依赖可以链接现有 node_modules。先确认 src、dist 不是共享目录链接，避免 `npm run clean` 清理其它任务的构建产物。在副本中串行执行：

```sh
npm run build
node --test dist/test/cli/processTermination.test.js dist/test/cli/cliProcessRuntime.test.js dist/test/cli/processLifecycle.test.js
```

控制器回归使用受控 ChildProcess、时钟和信号端口，不触达测试编号对应的真实进程。覆盖 close 后无迟到 KILL、仍运行时一次升级、重复停止、首次 kill 前已 close、显式强杀、spawn 失败、POSIX 回退及 Windows 已关闭对象不调用 taskkill。runtime 回归额外检查两个公开执行入口实际接入控制器、capture 超时取消升级及 taskkill 参数与异步错误。

本机 POSIX Node fixture 仅向自己启动的隔离 child/group 提出 TERM，核对输出尾部、onExit 及真实 close/drain；既有 processLifecycle fixture 核对 exit 之后继承管道的尾部，不改用 timer 推断排空。Windows 分支模拟通过只证明分支控制及参数合同，不等于 Windows 实机 taskkill 或 Linux 实机验证。

本次最小回归不重跑已通过的 round-366 OpenCode 真实双轮、不运行部门 60 项用例、不复现 PID 劫持、不扫描进程。最终必要平台验证与合并后全量回归仍是根门禁；本手册和 attempt 报告不替代其验收。
