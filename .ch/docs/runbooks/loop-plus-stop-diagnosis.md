# Loop+ 未完成目标时暂停的排查方法

## 适用现象

Loop+ 聊天出现“任务已完成”，群聊最后若干子任务验收通过，但整体目标仍未完成，之后没有新派发。

## 必须区分的状态

- **单次 CLI 调用完成**：交互执行正常返回，可能只是生成了验收或阻塞决策，不代表父任务完成。
- **子任务验收通过**：只确认本次派发范围，工具、文档或诊断交付通过不能代替产品整体运行验收。
- **父任务完成**：需要有效的 `completed` 决策与父任务持久化完成状态。
- **主模型报告阻塞**：首次全局 `blocked` 会触发一次有限的剩余工作复核，不立即等同父任务暂停；复核后仍阻塞才将父任务持久化为 `needs-review`。暂停保留未完成状态，不等于主任务完成。

当前调用链为 `applyBlockedDecision` → `loopPlusBlockReview=pending` → 带 `Bounded blocked review` 的一次主任务复核。若复核发现安全、独立的工作，继续派发并清除该复核状态；否则 `pauseForReview` → 编排宿主 `pause`，设置 `autoPaused`，持久化 `needs-review`、阻塞摘要与已复核状态，通知用户并记录到主任务沟通文件和群聊 transcript。该状态跨宿主重建保留；没有新的用户补充、派发或验收进展时，不会重复复核或自动发起相同阻塞调用。

## 只读取证顺序

1. 从 `~/.sinitek_cli/loop-tasks/` 定位 workspace、CLI、session 与父任务 ID，读取 `taskStoreFile`、`communicationDir` 及各子任务 `communicationFile`，不要拼造 attempt 文件名。
2. 对齐 `~/.sinitek_cli/logs/` 的启动时间、群聊子任务加入/结束、主会话最终协议 JSON 和暂停系统消息。日志中的 `Z` 是 UTC，北京时间需要加八小时。
3. 如果 CLI 日志仅包含启动事件，继续查对应主会话消息和原生会话事件；不能把最后一次启动时间当作执行结束时间。
4. 沟通文件里的报告核对实际执行、退出码、未满足前置条件和授权边界；诊断探针失败不等于插件或 CLI 进程崩溃。
5. 以暂停前的带时间戳快照确认已验收数量、验收上限、running、pending、reviewQueue、currentReview、completed、parentStopped 和最终决策。恢复后的最新快照不能反推昨晚状态。
6. 核对 `blocked`、协议错误、连续主模型失败、验收上限及手动停止的具体通知，避免混用同一 session 下前一个父任务的失败记录。

## 典型误判与后续处理

- `mainAiFailureCount=5` 不等于模型服务连续报错。先核对 `mainAiLastFailureMessage`：若为 CODEX_THREAD_HANDOFF_FAILED / waiting_close，失败可能发生在发起模型请求之前。0.145.0 原生默认卸载为 30 分钟，旧共享策略的 75 秒交接等待不能收敛；原生会话 metadata 的创建版本只证明创建时版本，历史启动版本仍应与实际可执行路径证据区分。
- 兼容策略仅共享已确认支持即时卸载的版本，其余连接按 runner 归属专用；恢复前等待原进程实际退出，不强杀共享或外部 writer。Loop+ 对不可重试的会话错误第一次就暂停，保留当前验收与队列；其它错误最多连续五次。群聊、主聊天、暂停文件展示相同原因，旧空摘要从失败字段重建。
- Loop+ 是事件驱动调度，不使用经典 `currentRound` 计数；历史记录中的 0 不能证明主任务从未派发或执行。

- `run.completedWithDuration` 反映单次执行状态；与父任务暂停通知相邻出现时，应以父任务决策和状态解释整体进度。
- 群聊最后一项为“通过”不意味着全部要求完成；主任务沟通文件也不保证包含最终暂停原因，应继续查 `finalSummary` 和原生最终回复。
- 暂停通知会展示阻塞摘要与恢复条件，主任务沟通文件和群聊 transcript 也应有带去重标记的暂停段落；如果聊天通知写入失败，仍应核对文件记录与 `loop-plus-pause-message-failed` 日志。
- 部分恢复执行被前置条件阻塞时，仍需检查是否存在独立且安全的实现、测试或文档任务；整体排队为空只说明当前没有已派发工作，不证明所有剩余目标均无法推进。
- 无新证据时不要无限重复同一失败诊断，也不要通过删除门禁、伪造成功或修改任务记录强制“继续”。需要人工条件时明确缺失证据、负责人及恢复触发方式。
- 核对任务是否已被后续用户消息恢复；只读调查不能打断正在执行的 attempt，也不能用恢复后的 `running` 否定历史暂停。

## 验证与事实来源

单次事故应同时有最终决策、暂停/完成通知、沟通记录与相应状态的证据。结构查询用于定位，当前源码用于确认，历史运行记录用于证明事件发生；不要以当前源码或测试代替历史证据。

- [决策策略](../../../src/extensionHost/loopPlusDecisionStrategies.ts)：`applyBlockedDecision`。
- [宿主编排](../../../src/extensionHost/loopPlusOrchestration.ts)：有界阻塞复核、`pause` 与显式继续路径。
- [协议提示](../../../src/extensionHost/loopPlusPromptBuilders.ts)：`blocked` 复核、`clarify`、`completed` 的契约。
- [暂停沟通记录](../../../src/loopPlusPause.ts)：主聊天、主任务沟通文件与群聊 transcript 的暂停说明。
- [单次调用完成文案](../../../src/promptRunState.ts)：`buildTaskRunCompletionText`。
- [消息映射](../../../src/extension.ts)：`loopPlusHostMessage`。
- [编排回归](../../../src/test/extensionHost/loopPlusOrchestration.test.ts)：有界复核、跨重建状态、暂停记录与父任务完成提示边界。

只读排查或本文档维护不要求启动业务、调用真实诊断、修改用户任务、执行 build 或重跑运行时单测；若改变暂停、恢复或提示行为，再按 [测试规则](../TESTING.md) 补最小回归并执行 build。
