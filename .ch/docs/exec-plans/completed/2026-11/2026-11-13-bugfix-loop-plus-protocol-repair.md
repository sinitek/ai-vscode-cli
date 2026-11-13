# Loop+ 协议矛盾后的主模型自动纠错

- 日期：2026-11-13
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

验收决策可同时包含修复任务和补充需求任务；如果新任务没有恰好关联一个 `reviews[].subtaskIds`，解析器拒绝整份决策。现有重试不携带拒绝原因，主模型重复审阅后仍返回相同错误；次数耗尽时也未持久化具体协议原因，界面误用业务阻塞兜底。

改为在协议校验失败或调度快照矛盾后，立即把具体拒绝原因、上一份回复及当前快照交回主模型，只修正 JSON，复用仍有效的验收证据。有效决策继续派发或完成任务；持续无效仍受现有上限约束，并保留真实原因。

## 范围与非目标

- 修改决策解析诊断、编排重试上下文及暂停说明；补充自动化回归和业务文档。
- 不放宽验收、事件关联、完成门禁或安全边界，不修改用户运行任务，不发布扩展。
- 不更换技术栈或依赖。

## 验收标准

- 未关联、重复关联或未知子任务关联被明确指出，失败决策不消耗验收事件或启动子任务。
- 无需用户点击继续，下一次主模型调用立即携带纠错说明和前次 JSON；纠正后可派发后续任务或合法完成。
- 已有验收证据继续复用，重试不会要求重做业务工作；队列扩大时以最新批次为准。
- 达到既有重试上限时保存具体协议原因，主聊天、暂停记录使用该原因。
- 正常决策、显式继续和完成后不遗留旧纠错上下文。

## 影响面、风险与缓解

- `src/loopPlusDecision.ts`、`src/extensionHost/loopPlusOrchestration.ts`、决策策略和暂停文案及相应测试。
- 修复提示包含前次输出，须明确视为待修正数据并限制长度；当前快照和协议优先。
- 保留重试次数和决策次数上限，不自动修补或强行采纳模型 JSON。
- 仅记录通用失败模式，不把本机任务、会话或私有原文写入仓库。

## 验证计划与清单同步

- 基线：隔离工作树 `npm run build`，已有事件关联和无效决策重试两个回归通过。
- 新增解析器、宿主编排与暂停记录回归；执行 `npm run build` 后运行最小相关测试。
- 使用本机已保存的两份失败 JSON 只读回放，验证诊断与最小字段修正；不重新调用用户模型或执行业务任务。
- 同步功能清单、Loop+ 调度设计、排障手册及 ontology；运行 ontology 校验和单测。

## 任务列表

- [x] 定位真实协议拒绝，确认最小修正可解析。
- [x] 实现诊断与自动纠错上下文。
- [x] 补回归并同步事实来源。
- [x] 完成构建、测试与只读回放。

## 当前结论

已确认事件关联门禁按既有契约拒绝无关联的新任务。缺陷在于重试缺乏错误反馈、耗尽后未记录协议原因。本次保持门禁，修复反馈与自动恢复流程。

## 验证与交付结论

- 已从隔离工作树安全合回当前工作区；复制前确认原工作区无并发修改，未复制依赖符号链接。未提交、发布或更新已安装扩展，未修改或恢复用户真实任务。
- 当前工作区 `npm run build` 通过。
- `node --test dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusProtocolRepair.test.js dist/test/loop/loopPlusPause.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/loop/loopBlockedSummary.test.js dist/test/loop/loopMainFailure.test.js dist/test/loop/loopPlusContracts.test.js dist/test/loop/loopPlusScheduler.test.js`：283/283 通过，无跳过。
- 本机两份失败 JSON 只读回放均准确指出未关联任务；仅补齐关联后接受，原通过/失败验收结论全部保留。真实任务内容未写入仓库或测试夹具。
- ontology `--validate` 通过，ontology Python 单测 9/9 通过；`git diff --check` 及本次全部变更文件空白校验通过。
- 全仓 `npm run validate:whitespace` 发现 `AGENTS.md:8` 原有尾部空白，已用 `git show HEAD:AGENTS.md` 确认为基线问题，未扩大修改范围。
- 测试失败分类：新增诊断的首个拒绝字段、空 wait 新增协议计数和入口夹具依赖旧暂停行为，均为断言/夹具过期；按新契约更新后上述完整相关范围通过。没有降低验收门槛。
- 设计、功能清单、排障手册和 ontology 已同步；可复用原因与恢复方法已上提到专题 runbook，不在热区重复记录任务流水账。
- 未运行无关全量测试、真实模型业务执行、原生 Windows/Linux 或已安装 VS Code 扩展端到端；本次为编排与文本提示变更，没有页面结构/样式变化，未做浏览器验证。已安装版本仍需更新后验证真实任务恢复。
