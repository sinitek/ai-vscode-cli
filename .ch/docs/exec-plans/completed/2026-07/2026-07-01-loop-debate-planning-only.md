# Loop红蓝辩论仅用于规划阶段

- 日期：2026-07-01
- 状态：completed
- 负责人：Codex

## 背景

当前 `debate_multi_agent` 在每个主任务复核轮都会启动红蓝辩论：裁判主持人组队、红蓝参与者发言、共识汇总器生成 `decision.json`，然后复用现有子任务执行链路。用户要求优化为：只有规划阶段才需要红蓝辩论；后续实现时由主持人作为主智能体，使用主从多智能体模式推进执行、复核和继续派发。

## 目标

- `debate_multi_agent` 新任务第一个自动规划决策轮仍执行红蓝辩论。
- 红蓝共识生成首批 `LoopMainDecision` 后，后续轮次不再反复启动红蓝辩论。
- 后续实现、验收和继续派发由主持人主智能体走现有主从多智能体链路，继续复用子任务批次、并发冲突规划、重试、沟通文件和最终总结。
- 主持人主智能体必须读取首轮红蓝简报、群聊、共识、决策和执行群聊，再做复核决策。

## 范围

- `src/extension.ts`：主循环决策分派、主持人主任务提示词、红蓝规划产物注入。
- `.ch/docs/design-docs/loop-debate-multi-agent-mode.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 必要测试和验证。

## 非目标

- 不改变顶层 `interactiveMode` 和 `LoopExecutionMode` 枚举值。
- 不重写现有红蓝主持人点名、参与者 artifact、共识汇总器协议。
- 不改变子任务执行器、冲突分组和重试策略。
- 不改变群聊面板的基本 UI 结构。

## 验收标准

- [x] `debate_multi_agent` 的第一个规划轮执行红蓝辩论。
- [x] 同一任务完成首轮辩论共识后，后续轮次走主持人主智能体的主从多智能体复核，不再创建新的 `debates/round-2`、`round-3`。
- [x] 主持人主智能体提示词包含首轮红蓝规划产物路径和后续主从执行职责。
- [x] 任务继续/恢复时，如果尚无可用红蓝规划共识，仍会补跑规划辩论；已有共识则直接进入主持人主从复核。
- [x] `npm run build` 和相关单测通过。

## 影响面

- 代码目录：`src/extension.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/exec-plans/`
- 配置与脚本：无新增配置；沿用 `npm run build`

## 风险与缓解

- 风险：历史 `debate_multi_agent` 任务可能已经存在多轮 `debateRounds`。
- 缓解：判断“规划辩论已完成”时读取任意已达成共识且产物完整的最早辩论轮，不删除历史记录。
- 风险：后续主持人主智能体忽略红蓝共识。
- 缓解：在专用提示词中显式列出必须读取的红蓝产物路径，并要求后续子任务以共识为规划基线。
- 风险：首轮辩论后没有绑定主任务真实 session。
- 缓解：后续复核继续使用现有主任务 tab；如果没有真实 session，则按现有 pending tab 行为运行。

## 验证计划

- 最小相关验证：`npm run build`
- 扩展验证：`node --test dist/test/loopDebate.test.js`
- 静态检查：`git diff --check`

## 测试与清单同步

- 单元测试：保留并通过现有 `loopDebate` 相关测试；本次核心分派判断仍在 `extension.ts` 私有编排中，未新增导出型纯函数单测。
- 功能清单：已更新 `FEATURE_INVENTORY.md` 中红蓝辩论主决策编排描述。
- 相关文档同步：已更新能力规格和红蓝辩论设计事实来源。

## 任务列表

- [x] 定位当前每轮触发红蓝辩论的主循环分派逻辑
- [x] 增加规划辩论完成判定与主持人主任务提示词
- [x] 调整 `runLoopPrompt` 后续轮次分派
- [x] 同步产品规格、功能清单和设计文档
- [x] 执行构建、相关测试与空白检查

## 决策记录

- 2026-07-01：保留 `debate_multi_agent` 作为用户可见二级模式，但将红蓝辩论限定为规划阶段；规划共识后的实现阶段由主持人主智能体复用主从多智能体链路。

## 当前结论

已完成。`runLoopPrompt` 现在仅在 `debate_multi_agent` 且缺少可复用红蓝规划共识时调用 `runLoopDebateRound`；已有完整规划共识后，后续轮次使用主持人主智能体提示词走主从多智能体复核。验证通过：`npm run build`、`node --test dist/test/loopDebate.test.js`、`git diff --check`。真实 VS Code Extension Host 端到端手工验收仍建议执行。
