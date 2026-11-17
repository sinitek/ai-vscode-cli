# Loop+ 有界批量验收与按目标补位

- 日期：2026-11-17
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

Loop+ 启动验收时冻结全部已有完成事件，单轮审查可能过大。用户要求每批最多验收 3 个子任务，其余按 FIFO 留给下一批；验收时同时判断最终目标的剩余工作，有必要且可并行时将修复和独立新任务同轮派发，尽量达到配置容量，不为填满而强制派发。

## 范围与非目标

- 在宿主计划验收和验收额度预检中使用统一的 3 项批次上限，保留冻结、重试、恢复和最终完成门禁。
- 主模型提示明确区分验收批次大小与运行容量，按真实未完成目标补位，考虑已有 running / pending、依赖、写入及会话冲突。
- 补充自动化回归并同步设计文档、功能清单和 ontology。
- 不新增配置、快照字段或队列，不改变经典 Loop、CLI 路由及界面布局。

## 验收标准

- 任何启动的验收请求最多包含 FIFO 前 3 项，其余保留待验收；超过三项的完成队列按批推进。
- 协议纠错不能确认第四项或后到项，重试保留当前批次；恢复重新从持久化 FIFO 取最多三项。
- 验收额度只预检本次冻结批次，不因下一批导致提前暂停；本批超过剩余额度仍整批拒绝。
- 验收后可同轮启动必要修复和独立剩余工作达到配置容量；目标已满足或无可并行工作时允许不补位。
- 待验收、运行中或排队任务继续阻止整体完成。

## 影响面与风险

- 代码：`src/loopPlusDecision.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`。
- 测试：对应 Loop+ 编排、提示、协议和完成门禁测试。
- 风险：额度预检若仍按完整队列计算会提前暂停；若批次确认扩张可能越批确认。用队列大于三项、协议重试和恢复用例保护。
- 补位是模型规划提示，不凭宿主臆造新任务；既有调度器继续限制并发与冲突。回滚可撤销本次局部变更，无持久化迁移。

## 验证计划

- 最小相关：`npm run build` 后执行编排与提示构建器测试。
- 扩展：Loop+ 协议、调度器、决策策略、最终完成门禁、运行时集成、群聊只读投影及 ontology 校验。
- 不改 Webview 布局，无浏览器验证需求；本次无需真实模型调用，隔离宿主夹具验证队列、派发与恢复行为。

## 测试与清单同步

- 单元测试新增/更新：新增三组宿主回归，覆盖八项队列按 3/3/2 分批、宿主重建恢复、无填充派发完成、越批拒绝与原批重试、三项验收后同轮六路修复/独立交付，以及仅按本批预检额度。提示回归覆盖全部五类主决策与两种模式，明确三项验收与配置运行容量独立、最终目标决定是否派发。
- 单元自测结果：`npm run build` 成功；`node --test dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js` 159/159 通过。
- 扩展回归命令：`node --test dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/loop/loopPlusProtocolRepair.test.js dist/test/loop/loopPlusSubtaskMode.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusAcceptanceCompletionGate.test.js dist/test/extensionHost/loopPlusAcceptancePlanHost.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusHandoffContracts.test.js dist/test/extensionHost/loopCrashRecovery.test.js` 242/242 通过。两组均无失败、取消、跳过或 TODO。
- 结构校验：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9/9 通过；改动范围 `node scripts/check_trailing_whitespace.js <本次文件>` 与 `git diff --check` 通过。
- 失败处理记录：无测试失败。一次检查时误用了不存在的空白脚本路径，已按 package.json 中的实际入口完成校验。
- 功能清单：已同步三项 FIFO 批次、额度预检及按需补位约定。
- 相关文档：`.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`。

## 任务列表

Tasklist:
- [completed] 核对现有调度、验收与剩余目标派发契约
- [completed] 实现三项验收批次与按目标补位提示并补充回归
- [completed] 执行验证、同步文档并归档计划

## 决策记录

- 2026-11-17：用户明确补位应由最终目的是否仍需工作决定，不强制填满。沿用 accept.subtasks 和 independentSubtaskIds，不新增派发协议。

## 当前结论

宿主以统一常量冻结最多三项 FIFO 验收事件，额度预检同步限制到本批；原 accept 同轮派发机制配合按目标补位提示继续使用，运行并发由现有配置与冲突保护决定。构建、401 项相关 TypeScript 测试和 9 项 ontology 测试均通过。

本次使用隔离宿主夹具验证调度和恢复，没有调用真实模型、运行原生 CLI 交接检测或图形宿主端到端；不修改 CLI 交接与 Webview 布局。补位依赖主模型对剩余目标与独立边界的判断，提示不保证每轮固定派发数量。收尾期间工作区出现本任务之外的扩展/群聊/子任务标签改动，均保留；上述测试覆盖构建时源码及本任务改动。

稳定规则已进入现有设计、功能清单与 ontology，无需另写热区摘要、事件记忆、runbook 或 skill。
