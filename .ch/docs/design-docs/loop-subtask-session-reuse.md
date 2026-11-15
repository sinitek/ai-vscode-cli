# Loop 子任务会话复用

## 任务来源与会话身份

经典 Loop 与 Loop+ 的主模型判断下一项工作是否延续此前子任务。连续工作通过 `subtasks[*].continueFromSubtaskId` 指定同一父任务下的来源子任务 ID；独立任务省略。重复派发相同子任务 ID 时也会优先使用该记录的会话。宿主不按标题、文件相似度猜测，不接受模型提供任意 CLI sessionId。

`LoopSubtaskRecord.executionSession` 持久化真实 CLI 返回的 `cli`、`sessionId` 和 `configId`。来源会话须有效，且 CLI、配置一致；本地占位会话不作为可恢复会话。旧记录没有绑定、来源不存在或配置不兼容时使用新会话，并记录原因。模型切换本身不等于配置切换；是否能在同会话切换模型仍以原 CLI 能力为准。

子任务 Tab 是展示与执行目标，CLI 会话是模型上下文。完成后仍可关闭 Tab；下一连续任务可以创建新的 Tab，并携带原 sessionId 恢复模型上下文。绑定保存在父任务记录，不能只保存在关闭后即丢失的 Tab 中。

停止和失败保留可继续的 Tab。重新派发后成功完成时，经典 Loop 与 Loop+ 共用 `src/extensionHost/loopSubtaskTabs.ts`，按父任务 ID 和子任务 ID 清理当前及更早的闲置 Tab，而非只关闭最后创建的 Tab；不删除真实 CLI 会话或聊天记录。清理以当次标签顺序快照为边界，跳过仍在执行的标签，不关闭更新的替代 attempt，即使替代 attempt 尚在等待会话锁、未登记运行状态。其它父任务、其它子任务和普通对话不受影响。

Loop+ 的主、子调用在 `runPrompt` 执行期间订阅宿主直接发布的 `TaskRunRecord`，按既有任务、轮次、角色、子任务、提示词和时间边界匹配本次真实终态，并在调用返回或抛错时释放订阅。读取决策与判断是否成功关页时优先使用捕获的记录，避免跨窗口共享 `tasks.json` 被覆盖或读盘失败后，将已有成功结果误判为 `failed`。未捕获记录的旧接线仍兼容历史读取；不能用 final answer 文字或完成提示代替真实成功记录，执行目录清理或 CLI 收口失败仍按失败处理。此保证覆盖当前进程的活跃调用，不保证共享历史文件在跨进程竞争下完整保留，也不重写已有失败快照。

路由未显式指定配置时，以目标 CLI 当前激活配置补齐本轮配置身份，并传给实际执行；不能把未填写的配置当作与真实绑定不兼容。显式路由配置优先，切换到不同配置后不恢复旧配置的会话。执行入口捕获的实际配置优先于适配器缺省值。

## Loop+ 验收修补与重派

`accept.reviews[*].subtaskIds` 表示本次验收事件关联的新任务。失败 review 的修补项若未显式声明来源，由宿主通过 `reviewEventId` 找到原 `subtaskId`，自动继承它的会话。不同失败项分别绑定自己的来源，不能把多个原会话任意合并；来源不唯一时需要主模型显式选择。

`controls.reprompt` 仍中断旧 attempt 并创建新 attempt，但设置来源为原子任务 ID。中断前先保存已有真实会话；新 attempt 不等于新 CLI 会话。新的独立工作不因处于同一模式就共享上下文。

`controls.close` / `controls.reprompt` 的关页要求可升级此前普通停止请求，不能因 attempt 已经中止而直接忽略；无论停止结果尚未结算还是已经结算，旧标签最多清理一次。恢复调度后若旧 attempt 句柄已不存在，按父任务和子任务身份清理旧闲置标签，不将“没有句柄”视为“没有标签”。

来源子任务应先结束；若要调整仍在运行的工作，使用既有控制重派。执行锁同时按父任务下的来源/目标子任务和 CLI 会话排序获取，防止同一线程并行接收两条请求，也覆盖最初尚未获得 sessionId 的执行。失败后释放锁，原有写入冲突约束继续生效。

## 执行边界与验证

### Loop+ attempt 执行准入端口

`LoopPlusRuntimeAdapterDeps.acquireAttemptExecution?(request: LoopPlusAttemptRequest, signal: AbortSignal): Promise<LoopPlusAttemptExecutionLease | null>` 是可选的内部注入点；租约仅有 `release(): void`。backend、frontend、general 子任务均经过准入，`runMain` 不调用它。未注入时保持原路由、session 选择与执行路径。本端口尚未接入 extension、部门设置或部门额度池，不增加用户可见功能，也不改变嵌套入口校验。

调用顺序为准入 → 子任务 Tab → `withLoopSubtaskSession` → `withLoopPlusExecutionRoot` → 原 `PromptRunInput/runPrompt` 与结果归属判断 → 目录清理 → 租约释放。等待准入不创建 Tab、执行目录，不持有 session 锁。返回 null 停止；准入抛错产生 failed 结果。每次 attempt 有独立 AbortController，钩子必须响应 AbortSignal 取消等待；适配器事件驱动地停止等待，仍防御忽略取消的迟到租约并释放它。准入返回与取消同轮发生时，执行前再次检查取消。

取消通过已有 `runPrompt.isAborted/onStarted` 端口约束：等待 session 锁、执行准备或已经结束的 attempt 不调用 `cancelInvocation`，只取消本 attempt 已启动且尚未结算的调用。停止或显式关 Tab 不提前归还租约；CLI Promise 与执行目录清理结束后，在 finally 中释放一次。根创建失败、CLI 失败和清理失败同样释放。释放失败成为 failed 结果并保留原错误；已停止且已结算的准入等待者收到迟到租约时，释放错误通过 `loop-attempt-late-lease-release-failed` 日志观察，未提供 log 时写入 stderr。取消后迟到的准入异常使用 `loop-attempt-cancelled-admission-failed` 日志。

可控 Promise 回归见 `src/test/extensionHost/loopPlusRuntimeAdmission.test.ts`；既有 session、路由、取消和 Tab 语义继续由 `loopPlusRuntimeIntegration.test.ts` 覆盖。

### DSH 的会话目录与 cwd

DSH ACP 恢复同时依赖原 `DSH_HOME` 和持久化会话的 canonical cwd，不只检查 session ID。Loop+ 外层仍为每个 attempt 创建并清理隔离根，但 DSH 实际从该会话隔离 HOME 下的 `loop-workspace` 真实目录执行；同一会话关闭 Tab、释放进程或验收失败后重新派发，均复用这一 cwd。普通 Vibe 继续使用真实工作区，不增加这层目录。

每次 DSH 隔离执行前，通过现有执行根工具重新链接本轮工作区入口，继续隐藏项目规则和 Skills；完成、启动失败、模型失败或结算失败后，按身份逐项清理本轮链接，仅保留空的稳定 cwd。不能递归删除、清空未知文件或用符号链接替换稳定根。目录非空、被替换或包含未知产物时保留现场并拒绝自动覆盖。Windows 的隔离 HOME 与工作区跨盘时，稳定 cwd 放在真实工作区的 `.sinitek-loop-tmp/dsh-<隔离HOME目录名>` 下，避免依赖跨盘硬链接或额外符号链接权限；其余平台优先放在隔离 HOME 中。

修复前绑定随机临时 cwd 的旧 DSH Loop+ 会话不做静默迁移：原协议拒绝 cwd 不一致时明确提示重新派发不复用旧会话的新子任务，不创建替代会话伪装恢复成功，不修改用户已有会话日志。该兼容边界与找回旧 `DSH_HOME` 的兼容扫描是两回事。

自动回归见 `src/test/extensionHost/dshLoopSessionResume.test.ts`、`src/test/loop/loopSubtaskExecutionRoot.test.ts` 和 DSH host 边界测试。`src/test/extensionHost/dshLoopSessionResumeLive.test.ts` 提供显式 opt-in 的本机真实验证：协议对照检查 cwd 约束，脚本主模型触发验收失败，真实 DSH 子模型在原 Tab 关闭且进程销毁后恢复原上下文并修复文件。它不是图形 Extension Development Host 点击验收，也不是主模型推理质量评测；调用方式与配置读取边界见本地开发 runbook。

经典 Loop 继续读取真实工作区规则、按汇报完成且不由主模型验收。Loop+ 的验收条件、次数限制、隔离执行目录、停止与恢复协议不变。续接上下文时必须使用本轮宿主指定的执行目录与沟通文件，不重复旧任务或使用已清理的历史临时目录。

实现入口：`src/loopSubtaskSession.ts`、`src/loopTaskStore.ts`、`src/extensionHost/loopOrchestration.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/extension.ts`。

回归覆盖来源解析、会话存储、CLI/配置隔离、共享会话串行、经典派发、Loop+ 失败修补、显式后续任务及控制重派。自动化模拟不等同于真实 CLI 端到端验证；不同 CLI 对已删除会话、历史 cwd 和模型切换的支持仍需本机真实环境验证。
