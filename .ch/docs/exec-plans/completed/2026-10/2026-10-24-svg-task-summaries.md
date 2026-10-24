# 各模式任务总结的 SVG 结构化补充建议

- 日期：2026-10-24
- 状态：completed
- 负责人：Codex

## 背景与目标

Vibe 已允许最终回复绘制 SVG，但没有明确建议用图示补充任务总结；Loop、Loop+ 和 Graph 的总结使用独立机器协议，需要在不破坏协议的前提下提供相同建议。

## 范围与非目标

- 覆盖 Vibe 通用最终回复、经典 Loop（含主持及红蓝共识）、Loop+ 主任务和 Graph summary 节点。
- 复用现有 SVG 渲染能力；不新增配置、不改 Webview、不改变调度或验收协议。

## 验收标准

- 四种模式均建议在有表达价值时以 SVG 补充文字总结，简单任务和用户要求纯文字时可省略。
- SVG 使用自包含的 `svg` 代码围栏，无脚本、事件处理器或外部资源。
- Loop/Loop+ 仅将图示放入 `finalSummary`，Graph 放入 `finalAnswer.summary`；JSON 正确转义，不新增协议字段或在 JSON 外追加图示。
- 子任务和 Graph 非 summary 节点不额外注入总结图示建议；机器协议仍不注入 `[final_answer]`。
- 构建、相关回归测试和 ontology 校验通过，功能清单与能力规格同步。

## 影响面

- 代码：`src/finalAnswerProtocol.ts`、各模式提示词构建器及相关测试。
- 文档：功能清单、输出渲染能力规格、现有图片及 SVG ontology 规则。
- 配置与脚本：无。

## 风险与缓解

- 风险：SVG 围栏或引号破坏 JSON，或建议变成强制画图。
- 缓解：共享建议明确按需、文字优先和 JSON 字段内正确转义；保留原协议、补充注入与排除范围回归测试。
- 回滚：撤销本次提示词及配套文档变更，不涉及存储或配置迁移。

## 验证计划

- `npm run build`。
- 定向执行提示词构建器、Loop 编排和最终总结相关 Node 单测。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`。
- `git diff --check`；无 Webview 改动，不新增浏览器冒烟。

## 测试与清单同步

- 单元测试：已覆盖 Vibe 及隐藏重试、经典 Loop 主任务及主持模式、红蓝共识、Loop+ 全部主任务唤醒类型和 Graph summary；验证可选文案、JSON 字段及转义约束、机器协议标记 opt-out、子任务及非 summary 节点排除范围。
- `npm run build`：通过。
- `node --test dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/loop/loopPromptBuilders.test.js dist/test/graph/graphPromptBuilders.test.js`：38 项全部通过。
- `node --test dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/loop/loopDebate.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/chatImagePreview.test.js dist/test/webview/chatImageResource.test.js`：69 项全部通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，58 条规则。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项全部通过。
- `git diff --check`：通过；变更范围的尾部空白检查通过。
- 失败处理记录：构建及测试无失败。
- 功能清单、能力规格与 ontology：已同步；新增规则 `plugin.rule.task_summary_svg` 指向现有模式提示词实现及能力规格。
- 记忆判断：稳定行为写入规格与 ontology，无需更新热区或事件记忆。

## 当前结论

已通过 CodeGraph 和当前源码确认四种模式入口，共享 SVG 建议与协议内包装均已落地并验证。该建议不强制绘图，不改变调度、验收或渲染机制。无界面改动，未运行浏览器冒烟；未调用真实模型验证绘图采纳率，该行为仍由模型按任务价值选择。
