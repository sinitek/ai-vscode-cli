# Loop 子任务会话复用

## 任务来源与会话身份

经典 Loop 与 Loop+ 的主模型判断下一项工作是否延续此前子任务。连续工作通过 `subtasks[*].continueFromSubtaskId` 指定同一父任务下的来源子任务 ID；独立任务省略。重复派发相同子任务 ID 时也会优先使用该记录的会话。宿主不按标题、文件相似度猜测，不接受模型提供任意 CLI sessionId。

`LoopSubtaskRecord.executionSession` 持久化真实 CLI 返回的 `cli`、`sessionId` 和 `configId`。来源会话须有效，且 CLI、配置一致；本地占位会话不作为可恢复会话。旧记录没有绑定、来源不存在或配置不兼容时使用新会话，并记录原因。模型切换本身不等于配置切换；是否能在同会话切换模型仍以原 CLI 能力为准。

子任务 Tab 是展示与执行目标，CLI 会话是模型上下文。完成后仍可关闭 Tab；下一连续任务可以创建新的 Tab，并携带原 sessionId 恢复模型上下文。绑定保存在父任务记录，不能只保存在关闭后即丢失的 Tab 中。

路由未显式指定配置时，以目标 CLI 当前激活配置补齐本轮配置身份，并传给实际执行；不能把未填写的配置当作与真实绑定不兼容。显式路由配置优先，切换到不同配置后不恢复旧配置的会话。执行入口捕获的实际配置优先于适配器缺省值。

## Loop+ 验收修补与重派

`accept.reviews[*].subtaskIds` 表示本次验收事件关联的新任务。失败 review 的修补项若未显式声明来源，由宿主通过 `reviewEventId` 找到原 `subtaskId`，自动继承它的会话。不同失败项分别绑定自己的来源，不能把多个原会话任意合并；来源不唯一时需要主模型显式选择。

`controls.reprompt` 仍中断旧 attempt 并创建新 attempt，但设置来源为原子任务 ID。中断前先保存已有真实会话；新 attempt 不等于新 CLI 会话。新的独立工作不因处于同一模式就共享上下文。

来源子任务应先结束；若要调整仍在运行的工作，使用既有控制重派。执行锁同时按父任务下的来源/目标子任务和 CLI 会话排序获取，防止同一线程并行接收两条请求，也覆盖最初尚未获得 sessionId 的执行。失败后释放锁，原有写入冲突约束继续生效。

## 执行边界与验证

经典 Loop 继续读取真实工作区规则、按汇报完成且不由主模型验收。Loop+ 的验收条件、次数限制、隔离执行目录、停止与恢复协议不变。续接上下文时必须使用本轮宿主指定的执行目录与沟通文件，不重复旧任务或使用已清理的历史临时目录。

实现入口：`src/loopSubtaskSession.ts`、`src/loopTaskStore.ts`、`src/extensionHost/loopOrchestration.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/extension.ts`。

回归覆盖来源解析、会话存储、CLI/配置隔离、共享会话串行、经典派发、Loop+ 失败修补、显式后续任务及控制重派。自动化模拟不等同于真实 CLI 端到端验证；不同 CLI 对已删除会话、历史 cwd 和模型切换的支持仍需本机真实环境验证。
