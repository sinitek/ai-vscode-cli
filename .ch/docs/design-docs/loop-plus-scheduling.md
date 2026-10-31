# Loop+ 子任务调度

## 调度边界

Loop+ scheduler 为纯状态内核，维护 `running`、`pending`、验收队列和可恢复快照；extension host 只启动 scheduler 返回的 `started` 项。生产并发上限为 6，单次决定的派发上限由独立设置约束。扩展宿主按每次实际启动间隔约 3 秒错峰，错峰队列不改变 scheduler 的准入状态。

## 准入与并行回填

- `running` 项（包括人工中断后等待续跑结果的开放 attempt）占并发槽，并通过 `writeFiles` 路径重叠与相同 `conflictGroup` 对新任务形成冲突约束。
- scheduler 依 pending FIFO 顺序检查候选项；同一次准入中已成功提升为 running 的项立即参加后续冲突检查。
- 由于冲突或并发上限仍未启动的 pending 项只保留队列顺序，不占并发槽，也不为后续候选预留写入范围。因此后续任务可越过被当前运行任务阻塞的 pending 项，填补可用并发槽。
- 后续候选仍必须与当前 running 及本次已提升的任务互不冲突。活动冲突释放后，再按 FIFO 选择最早的可运行项；更早 pending 项仍冲突时可以继续回填其它安全任务。
- 达到 `maxConcurrency` 时，仍未启动的任务留在 pending；结束任务会在同一 scheduler 转换中释放槽位并提升可运行项。

示例：A 写入 `x.ts` 正在运行，B 写入 `x.ts` 和 `y.ts` 因与 A 冲突而等待，C 仅写 `y.ts`。C 与 A 不冲突，应立即运行；B 在 A、C 中任一仍占用冲突范围时继续等待。

## 阻塞观测

`dispatch` 决策把 pending 原因归为运行中 `writeFiles` / `conflictGroup` 冲突或 `max_concurrency`。宿主 `loop-plus-dispatched` 日志为每个 pending attempt 记录 `subtaskId`、`attemptId` 和 `blockedBy`，冲突项附带冲突值及对应活动 attempt；异常未分类项使用 `scheduler`。pending 项之间不再报告互相阻塞。

## 验收方案快照

新建 Loop+ 根任务时，Webview 在 `sendPrompt` 前弹出“主模型验收方案”弹窗，把用户确认的复选项和“其它”审查内容作为 `loopPlusAcceptancePlan` 快照随请求提交。宿主只在该请求属于 `loop_plus` 且不是续跑/恢复/补充需求时接受该字段，归一化后连同 `loopTaskId` 一起写入 `LoopTaskRecord.loopPlusAcceptancePlan`；空基线快照不落盘，读不到的旧任务按固定清单处理。

- 方案下拉第一项是「新增方案」（空白草稿），其后是内置「默认方案」和已保存方案。方案名称输入框不显示标签：系统默认预填「默认方案」，新增方案为空，占位文字是「方案名称」。勾选「其它」后的文本域也不显示标签，占位文字是「审查内容」。保存时若名称已存在则覆盖那一条，不再新增第二条；「系统默认」这个名字仍不能占用。已保存的「默认方案」会顶替下拉里的内置项，避免出现两个「默认方案」；删掉后又回到内置项。已保存方案可删除，删除前弹出确认；内置方案没有删除按钮。下拉、「保存」和「删除」始终同一行，窄屏时下拉收缩，按钮不换行。

- 快照与模板解耦：弹窗里的方案是可复用模板，任务记录里的是确认时刻的副本。之后修改或删除模板不改变已启动任务；续跑、恢复、补充需求直接读任务记录里的快照。
- 提示注入：`initial` / `review` / `closeout` / `continue` / `user` 五类主模型提示共用同一份快照，只在固定验收清单之后追加已勾选审查项与有效“其它”文本，要求逐项给出证据或显式“不适用”。固定清单、调度协议和“主模型不得自行实现或修复被派发工作”的约束不变。
- 简短验收反馈：`accept` 或 `completed` 真正结束验收后，Loop+ 群聊追加一条「验收结果」气泡，逐项显示通过/未通过及证据型原因；原因语言按任务、证据和上下文选择，不强制中文。即使没有附加快照，也必须显示固定六项默认验收：实现完整性、契约一致性、测试验证、产物可运行性、改动合理性、回归与边界检查。「其它」仅展示本次结论和原因，不重复长篇审查要求。
- 反馈协议：`accept.reviews[].reason` 解释各事件的结果，`accept.acceptance.checks[].detail` 和 `completed.acceptance.checks[].detail` 解释六项默认检查；已选择的附加项通过 `acceptancePlanResults[].reason` 解释。每条原因按 Unicode 字符计数不超过 50 字，不适用时说明具体限制，不能编造通过证据。运行时拒绝缺失、空白或超长原因，以及缺少默认项或所选附加结果的决策，走既有协议重试，不生成兜底评价或部分气泡；未发生验收时不写气泡。通用解析入口仍兼容旧数据，严格校验由 Loop+ 运行时启用。
- 固定基线不可关闭：归一化时强制包含基线项，前端布尔值、旧版数据或可选配置都无法移除。
- 模板持久化：方案与当前选中项存工作区设置（`loopPlusAcceptancePlans` / `loopPlusAcceptancePlanSelection`），系统默认是内置只读项，不写入存储。只改模板不会改写已启动任务。
- 群聊修改：Loop+ 群聊顶部「验收方案」打开同一弹窗，确认后把当前复选项写回该任务的 `loopPlusAcceptancePlan`。下一次主模型验收提示立即读取新快照；若复核或收尾正在进行，宿主中止这一轮并按新快照重新提问。空基线会清掉任务上的附加快照。主任务状态为 `completed` 后不再显示该按钮。

## 事实来源与验证

- 实现：`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/loopPlusAcceptancePlan.ts`、`src/extensionHost/loopPlusAcceptancePlanHost.ts`、`src/webview/viewContentScript/acceptancePlan.ts`
- 回归：`src/test/loop/loopPlusScheduler.test.ts`、`src/test/extensionHost/loopPlusOrchestration.test.ts`、`src/test/core/loopPlusAcceptancePlan.test.ts`、`src/test/extensionHost/loopPlusAcceptancePlanHost.test.ts`、`src/test/webview/loopPlusAcceptancePlanDialog.test.ts`
- 验证：`npm run build`；`node --test dist/test/loop/loopPlusScheduler.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/core/loopPlusAcceptancePlan.test.js dist/test/extensionHost/loopPlusAcceptancePlanHost.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/webview/loopPlusAcceptancePlanDialog.test.js dist/test/loop/loopTaskStore.test.js dist/test/core/workspaceSettingsStore.test.js`
