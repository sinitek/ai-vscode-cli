# 各模式任务总结的 SVG 结构化补充建议 — 新功能开发

- 日期：2026-10-24
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-24-svg-task-summaries.md`（历史标识，原文件已替换）
- 关联计划：原 docs companion `2026-10-24-docs-svg-task-summaries.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 历史归档范围

为各模式最终总结新增可选 SVG 建议，保持机器 JSON 协议。 原始日期、状态和类型见头部；原文中的实现约束、验收、追加决策、历史验证、失败及未覆盖边界保留在下方。测试计划移除审计（如头部所列）仅记录历史测试职责与证据，不表示本类型重新执行。

## 原文归属记录

## 背景与目标

- Vibe 已允许最终回复绘制 SVG，但没有明确建议用图示补充任务总结；Loop、Loop+ 的总结使用独立机器协议，需要在不破坏协议的前提下提供相同建议。

## 范围与非目标

- 覆盖 Vibe 通用最终回复、Loop 主任务、Loop+ 主任务。

- 复用现有 SVG 渲染能力；不新增配置、不改 Webview、不改变调度或验收协议。

## 验收标准

- 四种模式均建议在有表达价值时以 SVG 补充文字总结，简单任务和用户要求纯文字时可省略。

- SVG 使用自包含的 `svg` 代码围栏，无脚本、事件处理器或外部资源。

- Loop/Loop+ 仅将图示放入 `finalSummary`；JSON 正确转义，不新增协议字段或在 JSON 外追加图示。

- 子任务不额外注入总结图示建议；机器协议仍不注入 `[final_answer]`。

- 构建、相关回归测试和 ontology 校验通过。

## 影响面

- 代码：`src/finalAnswerProtocol.ts`、各模式提示词构建器。

- 配置与脚本：无。

## 风险与缓解

- 风险：SVG 围栏或引号破坏 JSON，或建议变成强制画图。

## 验证计划

- `npm run build`。

- 定向执行提示词构建器、Loop 编排和最终总结相关 Node 单测。

- `git diff --check`；无 Webview 改动，不新增浏览器冒烟。

## 测试与清单同步

- 验证可选文案、JSON 字段及转义约束、机器协议标记 opt-out、子任务排除范围。

- `npm run build`：通过。

- `node --test dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/loop/loopPromptBuilders.test.js`：38 项全部通过。

- `node --test dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/loop/loopGroupChat.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/chatImagePreview.test.js dist/test/webview/chatImageResource.test.js`：69 项全部通过。

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，58 条规则。

- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项全部通过。

- `git diff --check`：通过；变更范围的尾部空白检查通过。

- 失败处理记录：构建及测试无失败。

- 无需更新热区或事件记忆。

## 当前结论

- 已通过 CodeGraph 和当前源码确认四种模式入口，共享 SVG 建议与协议内包装均已落地并验证。该建议不强制绘图，不改变调度、验收或渲染机制。无界面改动，未运行浏览器冒烟；未调用真实模型验证绘图采纳率，该行为仍由模型按任务价值选择。
