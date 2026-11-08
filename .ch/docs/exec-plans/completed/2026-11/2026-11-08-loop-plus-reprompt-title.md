# Loop+ 纠正重派同步更新子任务标题

- 日期：2026-11-08
- 状态：completed
- 负责人：Codex

## 背景与目标

Loop+ 的 `reprompt` 当前允许省略标题，编排会沿用旧标题，导致纠正后的执行范围与任务名称不一致。要求重派时同步提交反映纠正目标的新标题，并沿既有持久化和面板投影链路显示。

## 范围与非目标

- 范围：控制协议类型与解析、主模型提示和示例、标题传播回归、功能清单和 ontology。
- 非目标：不改变子任务 ID、会话复用、停止及验收规则；不新增标题生成服务或界面按钮。

## 验收标准

- `reprompt` 必须携带非空标题；缺失或无效时拒绝整份决策，不停止旧执行。
- 主模型提示与示例要求使用反映纠正目标的简体中文标题，不沿用已过时标题。
- 新标题同步到新 attempt、调度快照、任务记录和群聊启动通知；重建宿主后仍有效。
- `close` 无需标题，现有控制及验收规则不变。
- 构建、相关单元测试和 ontology 校验通过。

## 影响面、风险与缓解

- 代码：`src/loopPlusDecision.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/extensionHost/loopPlusOrchestration.ts` 及相关测试。
- 文档：功能清单、Loop+ 调度设计、现有子任务控制 ontology 规则。
- 风险：旧格式控制响应缺失标题会触发协议重试；同步提示和示例，拒绝时保留旧执行，避免无标题重派。
- 回滚：撤回本次协议及提示变更；无持久化结构迁移。

## 验证计划

- 先补回归并确认现有实现失败，再修复并执行 `npm run build`。
- 运行决策解析、调度、决策策略、编排、提示、运行时集成及面板状态相关测试。
- 运行 ontology `--validate`、ontology skill 单测及 `git diff --check`。
- 不改变界面结构或样式，不要求浏览器布局验证；不启动收费真实 CLI。

## 当前进展

Tasklist:
- [completed] 定位重派时标题未更新的原因
- [completed] 修复标题更新并补充回归测试
- [completed] 同步文档并完成构建验证

## 测试与文档同步

- 回归先行：新增解析拒绝、全提示类型标题要求、无标题不停止旧执行三项测试，修复前均失败；修复后连同标题传播回归共 4 项定向测试通过。
- 已补充群聊同一子任务重派后的标题投影回归，并更新宿主重建后的标题断言；最终 247 项相关测试全部通过。
- 功能清单、调度设计及 ontology 已同步。
- 本次无需修改 `ARCHITECTURE.md`、热区记忆或运行手册：架构与运维方式不变，稳定规则写回现有事实来源。

## 最终验证记录

- `npm run build`：通过。
- `node --test dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopSubtaskSession.test.js dist/test/loop/loopPlusGroupChatPanel.test.js`：247 项通过，0 失败。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- `git diff --check`：通过。
- 失败分类：测试先行的 3 项定向失败均为本次协议缺少标题约束的实现缺陷，修复后通过；最终无范围外失败。
- 验证边界：执行了真实本机 TypeScript 构建、纯状态/宿主适配器测试和群聊状态投影测试；未启动 VS Code Extension Development Host、浏览器或收费真实 CLI，未验证已安装扩展的现场表现。

## 当前结论

Loop+ 纠正重派必须携带反映新目标的标题，缺失时保留旧执行并重试主模型决策。合法新标题已验证同步到新 attempt、调度快照、持久化任务、群聊成员和启动通知；子任务标识与会话连续性保持不变。
