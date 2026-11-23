# Loop 子任务会话复用

## 任务来源与会话身份

经典 Loop 与 Loop+ 的主模型判断下一项工作是否延续此前子任务。连续工作通过 `subtasks[*].continueFromSubtaskId` 指定同一父任务下的来源子任务 ID；独立任务省略。重复派发相同子任务 ID 时也会优先使用该记录的会话。宿主不按标题、文件相似度猜测，不接受模型提供任意 CLI sessionId。

`LoopSubtaskRecord.executionSession` 持久化真实 CLI 返回的 `cli`、`sessionId` 和 `configId`。来源会话须有效，且 CLI、配置一致；本地占位会话不作为可恢复会话。旧记录没有绑定、来源不存在或配置不兼容时使用新会话，并记录原因。模型切换本身不等于配置切换；是否能在同会话切换模型仍以原 CLI 能力为准。

Grok 的 ACP session 还依赖 cwd。Loop+ 将稳定隔离根标识与原生会话一并持久化。对于 1.9.x 旧绑定，宿主仅从 Grok 原生会话索引中接受唯一匹配的旧版临时根；该目录消失时可按原路径重建，且将路径绑定到新记录以保证之后仍使用相同 cwd。没有唯一可信匹配或目录非空时，以明确标注的新 Grok 会话继续当前子任务；原生旧会话数据不删除，Owner 仅对精确匹配原 Grok 会话的无根旧绑定放行换绑。已有根标识会话恢复失败仍严格报错，不改用新会话。

子任务 Tab 是展示与执行目标，CLI 会话是模型上下文。完成后仍可关闭 Tab；下一连续任务可以创建新的 Tab，并携带原 sessionId 恢复模型上下文。绑定保存在父任务记录，不能只保存在关闭后即丢失的 Tab 中。

停止和失败保留可继续的 Tab；新 Tab 启动并复用相同 CLI 会话时，由公共执行入口与交互宿主调用 `src/extensionHost/sessionTabOwnership.ts`，先停止旧任务并关闭旧 Tab，空闲重复 Tab 也关闭，仅保留目标 Tab，聊天历史继续保留。接管以真实运行中的 CLI/session 绑定为准，逐个复核候选对象、CLI 和标签会话绑定；每次异步关闭后重新检查候选和最终所有者，防止已替换的标签或新所有者被旧快照误操作。准备期间目标对象、CLI、会话绑定、工作区变化或取消都会使启动失效；停止或关闭未完成时拒绝启动，不跳过 CLI 写锁交接。

目标身份在异步准备前捕获，并在准备完成、CLI 启动前再核对。会话健康检查自身主动换新会话，或命令修复主动创建新会话重放时，更新本次预期绑定后仍允许重试；等待期间外部替换或换绑目标则取消这次启动。

重新派发后成功完成时，经典 Loop 与 Loop+ 仍共用 `src/extensionHost/loopSubtaskTabs.ts`，按父任务 ID 和子任务 ID 清理当前及更早的闲置 Tab，而非只关闭最后创建的 Tab；不删除真实 CLI 会话或聊天记录。成功回报或 Loop+ 完成事件提交后立即执行 Tab 清理，不等待可选子会话压缩及其同会话前序 flight；之后压缩仍按会话串行。压缩失败或跳过也关页。回报或事件提交失败保留 Tab。清理以完成时捕获的标签顺序及对象/CLI/会话/子任务身份快照为边界，跳过仍在执行的标签，不关闭更新或换绑的替代 attempt，即使替代 attempt 尚在等待会话队列、未登记运行状态。宿主返回后复核标签移除结果，关闭未生效记录失败而不是成功日志。启动接管按相同 CLI 会话判断，完成清理按父任务与子任务判断，两者复用既有关闭入口。

Loop+ 的主、子调用在 `runPrompt` 执行期间订阅宿主直接发布的 `TaskRunRecord`，按既有任务、轮次、角色、子任务、提示词和时间边界匹配本次真实终态，并在调用返回或抛错时释放订阅。读取决策与判断是否成功关页时优先使用捕获的记录，避免跨窗口共享 `tasks.json` 被覆盖或读盘失败后，将已有成功结果误判为 `failed`。未捕获记录的旧接线仍兼容历史读取；不能用 final answer 文字或完成提示代替真实成功记录，执行目录清理或 CLI 收口失败仍按失败处理。此保证覆盖当前进程的活跃调用，不保证共享历史文件在跨进程竞争下完整保留，也不重写已有失败快照。

每个符合快照条件的旧标签分别尝试关闭，某个关闭或后续界面刷新失败不阻断本次完成标签及其余候选的清理；完成后汇总失败标签 ID 和原因。即使部分清理失败，也在压缩 flight 结束后复核已不再引用的 runner 并释放。自动清理通过宿主关闭入口的 `replaceLastTab` 选项，在只剩目标标签时先创建同 CLI 的空白对话，再移除原标签，避免“至少保留一个标签”规则留下已完成子任务；先执行活动运行和主任务关闭锁检查。空白标签的完整状态在配置恢复前发布，因为只移除标签的回执无法向 Webview 引入新标签；配置恢复失败也不遗留已关闭的旧标签界面。普通手动关闭最后一个标签沿用原行为。

路由未显式指定配置时，以目标 CLI 当前激活配置补齐本轮配置身份，并传给实际执行；不能把未填写的配置当作与真实绑定不兼容。显式路由配置优先，切换到不同配置后不恢复旧配置的会话。执行入口捕获的实际配置优先于适配器缺省值。

## Loop+ 验收修补与重派

### 执行尝试身份

Loop+ 宿主为每次 attempt 分配唯一 `attemptId`，并将它映射为运行输入、`TaskRunDraft` / `TaskRunRecord` 与聊天消息上的可选 `loopAttemptId`。运行选择、助手消息选择和续接详情查询在调用方提供明确 `attemptId` 时必须要求字段相等；候选缺失或不匹配时不按 prompt、时间、轮次或子任务回退。订阅的完成事件和事后扫描复用相同判定。没有新字段的旧记录及 classic Loop 流继续兼容，不做全量迁移。

从子任务会话最近的有效消息解析到的 `attemptId` 可用于构造续接 `PromptRunInput` 和过滤对应运行记录。Loop+ 手动续接通知在原有 `onCompleted` 参数后追加可选 `attemptId`；明确提供身份时，宿主只接受与开放 reservation 完全相同的 attempt，并在冷恢复状态写入前完成核对。旧无身份调用保留原兼容边界，不通过提示词、时间或 subtaskId 补猜身份。完成、停止及控制清理的自动压缩通知都传入对应 attempt；成功结果先持久化，再放行该 attempt 的压缩与标签清理。控制清理按父任务、子任务和 attempt 过滤标签，替代 attempt 不受旧通知影响；父任务主动停止、重复通知和 reprompt 前的迟到通知不能结算新 attempt。

自动压缩 `defer` 保存输入 `loopAttemptId` 的值快照，不随输入对象复用而改变；`notify(taskId, subtaskId, completed, onCompleted?, attemptId?)` 仅消费身份完全相等的 pending，无身份通知只兼容无身份旧 pending。不匹配或重复通知不消费 pending，也不运行其压缩或清理回调。完成回调只在成功汇报/事件提交后提供，并在等待同会话前序压缩前立即运行；同一 CLI/session 的压缩保持串行，清理不受压缩延迟影响，独立会话继续推进；失败或停止只取消对应身份的 pending，不改变真实执行所有权及现有停止边界。

`accept.reviews[*].subtaskIds` 表示本次验收事件关联的新任务。失败 review 的修补项若未显式声明来源，由宿主通过 `reviewEventId` 找到原 `subtaskId`，自动继承它的会话。不同失败项分别绑定自己的来源，不能把多个原会话任意合并；来源不唯一时需要主模型显式选择。

与当前验收事件无关的剩余目标交付放在 `accept.independentSubtaskIds`，同轮仍通过 `subtasks` 派发，不自动继承失败事件会话。真正独立的交付省略 `continueFromSubtaskId`，避免误用修复会话造成不必要串行；继续其它已有工作时可明确指定兼容来源。任务须恰好归属一个事件或独立列表，原冲突和会话串行保护不变。

`controls.reprompt` 仍中断旧 attempt 并创建新 attempt，但设置来源为原子任务 ID。中断前先保存已有真实会话；新 attempt 不等于新 CLI 会话。新的独立工作不因处于同一模式就共享上下文。

`controls.close` / `controls.reprompt` 的关页要求可升级此前普通停止请求，不能因 attempt 已经中止而直接忽略；无论停止结果尚未结算还是已经结算，旧标签最多清理一次。恢复调度后若旧 attempt 句柄已不存在，按父任务和子任务清理旧闲置标签；Loop+ 在已有身份时进一步限定原 `attemptId`，不将“没有句柄”视为“没有标签”，也不触碰替代 attempt。

来源子任务应先结束；若要调整仍在运行的工作，使用既有控制重派。执行锁同时按父任务下的来源/目标子任务和 CLI 会话排序获取，防止同一线程并行接收两条请求，也覆盖最初尚未获得 sessionId 的执行。失败后释放锁，原有写入冲突约束继续生效。

Loop+ 停止时可取消来源预留、后台压缩及 `runPrompt` 启动前的准备等待，未启动 CLI 的 attempt 上报 `stopped` 并释放自己的预留，不等待前驱执行或原压缩结束。取消队列中间项不能让后继越过前驱；原执行与压缩继续受会话级串行保护。准备迟到返回后仍检查取消状态，不再派发 CLI。`onStarted` 之后必须等待实际调用返回，不能因 Tab 消失或停止请求而提前结算真实运行。

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

生命周期三文件 186/186、压缩库 14/14、入口路由 2/2 的结果按各自范围复用。后续真实 Extension Development Host 身份检查已通过并获主审接受：VS Code 激活、命令及 openPanel 成功，源码与产物对齐；冷宿主拒绝显式旧 attempt 且零写入、保留替代 reservation，匹配完成先持久化再压缩清理，重复通知不重复提交或清理。生产 Tab 关闭守卫实际执行并保留替代 attempt 的 Tab，最终启动器退出 0 且 `harnessCompleted:true`；最小 Tab 夹具不代替完整 GUI、浏览器或真实 CLI 验证。

原 Node 全量 4,221 项（4,172 通过、46 失败、3 跳过）及 Python 88 通过、1 跳过已执行；六项定向修复覆盖全部 46 项失败并获主审接受。socket 轮最新构建覆盖全部源码修复，其后没有源码修改；没有重新拼接为一次全量全绿运行，live 与平台跳过仍保留。round-24 文档最终差异已获主任务审阅接受；实施提交 `1b3dfb1f1ce68da4d09fb1c7f38764b2f2710958` 已推送并核对 `origin/master`，两份计划标记 completed 并按 2026-11 归档。分项证据与实施 Git 结果见[身份交接计划](../exec-plans/completed/2026-11/2026-11-15-bugfix-loop-plus-attempt-identity-handoff.md)；归档收尾提交及推送结果见 round-25-loop-plus-final-git-delivery.md 报告。

实现入口：`src/loopSubtaskSession.ts`、`src/loopTaskStore.ts`、`src/extensionHost/loopOrchestration.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/extension.ts`。

回归覆盖来源解析、会话存储、CLI/配置隔离、共享会话串行、经典派发、Loop+ 失败修补、显式后续任务及控制重派。自动化模拟不等同于真实 CLI 端到端验证；不同 CLI 对已删除会话、历史 cwd 和模型切换的支持仍需本机真实环境验证。
