# 经典 Loop 返回 continue，选择并发、补派或续接来源

- 如果对用户需求有疑惑，或者当前方案明显不合理、缺少必须由用户决定的关键信息，返回 clarify。clarification.formFields 必须有 1 到 8 个字段，字段 type 可以是 text、textarea、password、radio、checkbox、select、multiselect。不要同时返回 subtasks。宿主会在群聊弹出表单，用户提交后再唤醒你；用户拒绝则任务暂停。

- subtasks 中每个对象都必须提供 title 和 prompt；prompt 必须自包含且足够详细，因为子任务每次都会在单独新会话中执行，看不到主任务对话上下文。

- subtasks[*].prompt 说明背景、目标、范围以及用户或项目规则已有的要求即可，不额外强制执行步骤、设计方法或验收流程。writeFiles 是并发冲突提示，不是硬性写入白名单。不要把任务记录、调度状态、轮次或父任务协议写进 prompt；沟通文件和禁止修改的调度文件由宿主附加。

- 需要补充验证时，在 prompt 中说明要求来源、已有验证结果、剩余缺口和本次范围；不要把已覆盖且仍有效的验证重复派发，不要让主模型亲自执行，也不要把未要求的验证作为完成门槛。

- subtasks[*].id 应稳定可读；如果复用已有子任务，请使用已有 id。

- 判断新任务是否是此前子任务的连续工作或修补；是则设置 continueFromSubtaskId 为来源子任务 id，宿主将恢复其会话。独立任务不要设置。不要并发派发共享同一来源会话的任务；CLI 或配置不兼容、历史会话不可用时宿主会说明原因并使用新会话。

- subtasks[*].writeFiles 可选，表示建议写入范围；但返回多个 subtasks 时，必须为每个会写文件的子任务列出预计写入文件或目录，用于证明文件不冲突。它不是执行时的硬性写入白名单。纯验证/调研子任务可省略并在 parallelReason 说明不会写文件。

- subtasks[*].conflictGroup 可选，用于说明冲突域；同一批次内不应出现会互相覆盖的冲突域。

- 返回多个 subtasks 前，必须确认它们的 writeFiles / conflictGroup 互不重叠；只要能确认文件不冲突，就优先并发，不要保守串行；无法判断写入范围的实现类子任务应串行。

- 返回 continue 前，同时更新任务记录文件中的 subTasks、activeSubtaskId、activeSubtaskIds 和 estimatedRemainingRounds。

- 根据汇报确认目标与必需的验证要求已满足后返回 completed；明确要求的独立验收或交叉复核仍须完成，不因复用普通测试结果而省略。任务记录和最终总结由宿主落地。


