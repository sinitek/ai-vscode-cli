# Loop / Loop+ 宿主中断后的完成回报

## 恢复边界

VS Code 或扩展宿主意外退出后，原控制器、等待 Promise 和 CLI 进程句柄均不可继续使用。任务记录、会话消息、子任务沟通文件以及 Loop+ 调度快照是恢复依据；不接管崩溃前的外部进程，也不根据文件内容猜测成功。

`isLoopTaskRunOrphaned` 以当前宿主的真实所有权判断失联，持久化的 `activeSubtaskIds` 不再证明进程存活。运行核对将失去所有权的 running 主任务记为 stopped，并持久化 `runtimeInterrupted=true`；保留活动 ID、Loop+ 原快照和待验收队列，把 running 子任务标为 blocked。用户主动停止清除该标记，并继续走原停止策略。

重新打开不会自动执行任务。用户可在原子任务 Tab 手动继续；完成结果必须来自本次成功运行记录。原记录没有该标记且已经 stopped 时，无法可靠区分历史用户停止与旧版本的状态核对，不猜测恢复原因；应显式继续父任务。

## 经典 Loop

手动续跑成功复用 `finalizeLoopSubtaskRun`：更新子任务状态与摘要、写沟通记录、通知群聊，再关闭子任务 Tab。活动兄弟任务未完成时保留等待状态；全部活动任务完成后，允许恢复带宿主中断标记的父任务，再继续主任务协调。

最后一个子任务清空活动 ID 与主任务启动之间，关闭标签可能触发面板运行核对。该核对同样保留宿主中断标记，因此不会让随后唤醒失去资格。按父任务 ID 保留唤醒中的内存互斥，避免并发完成回调重复启动主任务。用户主动停止、完成或主模型失败限制仍阻止自动唤醒。

## Loop+

`notifySubtaskContinuation` 在缺少内存控制器时可接收原主任务目标及输入，从任务记录重建调度器。只允许原任务仍 running 或带宿主中断标记的 stopped；拒绝已完成、主动停止、主模型失败限制、非法快照、parentStopped 或不存在的开放 attempt。

恢复时先注册控制器，再发布 running 状态，避免状态刷新在交接间隙再次判为失联。原开放 attempt ID 不变，其余失去句柄的 running 预留保留为 blocked，供手动继续或显式父任务续跑使用，不制造 stopped 完成事件。收到结果的 attempt 沿用原 `applyFinish`，写沟通报告、更新群聊与快照、排入验收并唤醒主任务。完成通知成功处理后才自动关闭子任务 Tab；结果不能回报时保留该 Tab。

恢复控制器纳入 `collectRunningLoopTaskIds`，即使主任务没有直接 CLI 进程，仍可等待子任务、接收完成事件与停止。重复通知因原 attempt 已不在 running 而忽略。主模型路由与思考力度继续读取任务的持久化配置；验收门槛、失败修复和父任务最终完成通知保持原契约。

## 验证

- `src/test/extensionHost/loopCrashRecovery.test.ts`：真实临时磁盘任务存储、host 重建、兄弟任务等待、标签刷新交接、并发通知、主动停止及非法快照；另起 Node 子进程写状态后强制终止，再重建宿主并回报。
- `src/test/extensionHost/loopPlusRuntimeIntegration.test.ts`：用真实适配器与磁盘任务记录，从冷通知到主模型验收、沟通报告、父任务完成和控制器释放；模型回复使用脚本夹具。
- 验证命令：`npm run build` 后运行上述编译后的测试及相关 Loop/Loop+ 回归。进程强制终止测试不等同于 VS Code 图形宿主或真实模型验证。
