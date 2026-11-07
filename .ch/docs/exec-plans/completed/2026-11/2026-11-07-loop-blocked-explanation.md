# Loop / Loop+ 阻塞答复可读性

- 日期：2026-11-07
- 状态：completed
- 负责人：Codex

## 背景与目标

经典 Loop 的人工复核气泡只显示任务 ID 和记录路径，遗漏主模型给出的原因；Loop+ 的示例过于笼统，且无论是否能够恢复都会追加继续指引。本次让用户直接看懂阻塞原因、剩余工作、恢复前置条件，或任务在当前约束下无法完成的理由。

## 范围与非目标

- 覆盖两种模式的主模型阻塞说明约定、主聊天气泡、群聊中断说明及回归测试。
- 复用 `finalSummary`，不新增任务状态或持久化协议，不改变 Loop+ 有界复核、安全门槛和验收流程。
- 不调整主题、布局、依赖、CLI 调用参数或发布扩展。

## 验收标准

- 经典 Loop 的阻塞气泡显示真实原因，不再仅给记录路径。
- 两种模式都要求简体中文说明当前结论、原因与未完成事项、逐项恢复条件和责任方；确实无法完成时明确理由及可行替代，无依据时不能断言不可能。
- 不无条件要求用户补充材料或暗示点击继续就能解决问题；空说明有诚实中文兜底。
- 同步功能清单、业务规格与 ontology；构建和相关回归测试通过。

## 影响面与风险

- 代码：阻塞说明共享工具、Loop / Loop+ 提示构建器、状态机、主聊天与群聊说明。
- 文档：产品规格、功能清单、ontology。
- 风险：历史摘要缺少细节不能靠界面猜测补全；保留原始原因并明确证据不足。无法完成的判断由主模型基于任务事实输出，不做关键词猜测。

## 验证计划

- `npm run build`
- `node --test` 执行阻塞说明、暂停记录、提示构建、状态机、群聊与编排相关测试。
- ontology 校验及脚本单测；改动范围空白校验。
- 仅修改 Markdown 文案生成，不改浏览器布局；若发现需要渲染验证再使用现有浏览器 smoke 流程。

## 任务列表

- [completed] 定位阻塞说明的生成链路和约束
- [completed] 改进阻塞说明并补充回归测试
- [completed] 验证行为并同步相关文档

## 验证与文档同步记录

- 首次 `npm run build` 通过。
- 首批相关单测 229/231 通过；两项属于测试断言/夹具问题：新增用例误写主模型失败上限为 3（实际为常量定义的 5），旧暂停夹具依赖已移除的无条件继续尾注。已改为读取常量并使用包含自身恢复步骤的结构化夹具，不调整运行时门槛。
- 重跑 `npm run build` 通过。
- 相关回归命令：`node --test dist/test/loop/loopBlockedSummary.test.js dist/test/loop/loopPlusPause.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/loopTaskStateMachine.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/loop/loopFinalSummary.test.js dist/test/loop/loopGroupChat.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js`；283/283 通过。
- 全量回归：`node scripts/run_unit_tests.js`；共 3121 项，3118 通过、3 项按既有条件跳过、0 失败，约 40 秒。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9/9 通过。
- 本次变更文件执行 `node scripts/check_trailing_whitespace.js` 范围校验与 `git diff --check`，均通过。
- 已同步功能清单、业务规格和 ontology；稳定规则已有对应事实来源，不重复写入热区记忆或事件记忆。
- 未改主题、布局或浏览器代码，不需要页面布局 smoke；没有调用真实付费模型，模型遵循说明格式的表现未做额外在线验收。未运行发布脚本。

## 当前结论

已修复经典 Loop 展示层遗漏 `finalSummary`，两种模式复用同一中文说明约定；不依据关键词猜测能否恢复，不附加误导性的继续尾注。构建、283 项相关回归、全量单测、ontology 与空白校验均通过，任务完成。
