# 经典 Loop 按汇报推进与按需验证

- 日期：2026-10-31
- 状态：completed
- 负责人：Codex

## 背景与目标

经典 Loop 简化为主模型拆分、子模型执行并汇报、主模型基于汇报决定继续或完成。主模型不验收产物、不运行测试、不检查实现细节；用户明确要求或项目既有规则要求的验收、测试和构建检查，安排独立子任务执行。两者都未要求时，不额外安排验证。Loop+ 保持原有机制。

## 范围与非目标

- 修改经典 Loop 主子提示词、完成决策解析、项目规则加载和沟通模板。
- 恢复经典 Loop 子任务在真实工作区读取项目规则；保留 Loop+ 隔离执行和验收机制。
- 保留经典批次屏障、并发冲突控制、重试、停止、澄清、续跑和最终总结。
- 不改技术栈、依赖版本，不覆盖工作区既有未提交修改，不创建新分支或 worktree。

## 验收标准

- 主模型只信任执行汇报，判断任务覆盖和完成，不亲自验收或测试。
- 用户或项目规则要求的验证单独派发给子模型；没有要求不主动增加。
- 编码子任务按项目规则自主实施，不注入额外设计或强制验证流程。
- completed 不再要求 acceptance、requirementCoverage 或 roundSummaries；继续兼容历史字段。
- 经典子任务首次启动及续跑使用真实工作区与项目规则，Loop+ 和 Graph 执行策略不变。
- 新增回归、相关构建与测试通过；同步能力清单、架构和 ontology。

## 影响面与风险

- 经典编排、共享提示执行入口、经典完成解析、沟通文件模板、说明文案。
- 共享入口必须按持久化调度模式区分经典 Loop，不能放宽 Loop+ 的完成校验或规则隔离。
- 项目规则仍可能要求编码后的自测；主模型应识别这些要求，独立派发验证，不替用户或项目增加要求。

## 验证计划

- npm run build。
- 经典提示、完成解析、规则加载、沟通模板、状态机与子 CLI 路由回归。
- Loop+ 决策、主编排、运行适配器、验收方案和规则隔离回归。
- ontology validate 与对应 Python 单测；git diff --check。
- 不启动真实模型，不进行浏览器验证：本次修改是编排提示、协议和执行目录策略，不新增浏览器交互。

## 实施结果

- 经典主任务按汇报推进，不检查实现、不亲自验收或运行测试；仅用户或项目规则要求的验证另派独立子任务。
- 经典子任务按真实工作区项目规则自主实施，取消额外设计和实施步骤注入；首次派发及手动续跑共用中央入口策略。
- completed 只要求非空 finalSummary，历史 acceptance、roundSummaries、requirementCoverage 继续兼容但不阻断完成。
- 沟通模板、自动汇报、主任务决策记录和最终总结均区分模式，经典不再虚构主模型验收通过或要求补齐未要求的测试证据。
- Loop+ 和 Graph 的验收、执行隔离、模型路由及生命周期保持原有机制；未覆盖或回滚工作区既有修改。
- 已同步 ARCHITECTURE.md、能力规格、FEATURE_INVENTORY.md、CLI 运行时参考与 ontology；无需更新 ROLLING_SUMMARY 或 EVENT_MEMORY。

## 验证命令与结果

- `npm run build`：通过。
- 经典聚焦回归：78/78 通过，日志 `/tmp/classic-loop-focused-tests.log`。

```sh
node --test dist/test/extensionHost/promptExecutionShared.test.js dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/loop/subtaskDesignBriefPolicy.test.js dist/test/loop/loopTaskStore.test.js dist/test/loop/loopFinalSummary.test.js dist/test/loop/loopGroupChat.test.js dist/test/webview/loopPlusModeHelp.test.js
```

- Loop+/Graph 核心保护回归：201/201 通过，日志 `/tmp/loop-plus-protection-tests.log`。

```sh
node --test dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/core/loopPlusAcceptancePlan.test.js dist/test/extensionHost/loopTaskStateMachine.test.js dist/test/extensionHost/graphRuntime.test.js dist/test/graph/graphExtensionRuntime.test.js
```

- 续跑、隔离及全栈扩展回归：48/49 通过，日志 `/tmp/classic-loop-lifecycle-protection-tests.log`；唯一失败分类为范围外的既有工作区文案与断言不一致。

```sh
node --test dist/test/loop/loopSubtaskLifecycle.test.js dist/test/loop/loopSubtaskProgress.test.js dist/test/loop/loopSubtaskExecutionRoot.test.js dist/test/loop/loopSubtaskThinking.test.js dist/test/webview/loopPlusFullstackMode.test.js dist/test/webview/loopSubtaskCliRoute.test.js
```

- `loopPlusFullstackMode.test.ts` 期待 `data-help="子模型使用擅长前端编码的模型"`，工作区既有 Loop+ 文案为 `使用擅长前端编码的模型`。在内存恢复本次全部经典帮助文案后仍可复现，未改动 Loop+ 或此测试。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：两处既有 source_refs 失效，未新增本次规则的校验错误。`plugin.rule.dsh_profile_edit` 指向已删除的 `2026-10-26-dsh-config-import-visual-empty.md`，`plugin.rule.loop_plus_role_model_routing` 指向已归档计划的旧 active 路径；不恢复用户删除内容，不扩大无关规则修复。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：8/9 通过，唯一失败为 `test_validate_current_ontology`，原因同上两处失效引用。
- 本次文件 `git diff --check`：通过。

## 失败分流与未覆盖风险

- 开发阶段新增测试遇到 Object.hasOwn 与项目 TS lib 不兼容、续跑决策字面类型扩宽和规范化夹具字段不足，均属于测试夹具问题；已按现有 API 与实际规范化入口修正并重跑通过，未为测试放宽业务规则。
- 未调用真实模型、未进行真实 CLI 加载项目规则的端到端验证；中央执行入口、首次派发、续跑和三种 runner 的接线由自动化回归覆盖，实际 CLI 版本与用户本机规则发现差异仍是未覆盖风险。
- 未运行浏览器：本次没有新增页面布局或交互，只有经典模式帮助文案更新；静态文案及模式保护已有回归。
