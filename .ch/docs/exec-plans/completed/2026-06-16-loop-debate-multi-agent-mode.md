# 龙虾辩论多智能体模式

- 日期：2026-06-16
- 状态：completed
- 负责人：Codex / 协作

## 背景

当前龙虾模式已经具备稳定的主从多智能体链路：用户选择 `interactiveMode=lobster` 后，扩展创建龙虾任务记录，主任务返回 `LobsterMainDecision` JSON，再由现有子任务批次、冲突规划、重试、沟通文件和最终总结气泡链路推进任务。

现有问题集中在主任务规划/复核仍由单个主任务独立完成，复杂任务容易出现规划视角不足、过早收敛和验收偏置。设计文档 `.ch/docs/design-docs/lobster-debate-multi-agent-mode.md` 已决策采用方案 C：辩论式规划，复用现有子任务执行。

## 目标

交付龙虾模式内的新执行方式 `debate_multi_agent`，让多个规划/审查参与者在每轮派发子任务或完成判断前先形成可追溯的辩论记录和共识摘要，再输出兼容现有龙虾主任务协议的决策。

第一版完成后应满足：

- 顶层仍为 `lobster` 模式，不新增新的 `InteractiveMode`。
- 默认执行方式仍为 `main_sub_multi_agent`。
- `debate_multi_agent` 只替代主任务规划/复核阶段。
- 子任务派发、并发冲突规划、子任务重试、沟通文件、最终总结气泡、任务保留清理复用现有链路。
- 老任务缺少 `executionMode` 时按 `main_sub_multi_agent` 处理。

## 范围

- 协议和记录：新增 `LobsterExecutionMode`、任务记录字段、辩论记录类型、辩论目录路径和兼容归一化。
- Webview 设置：在龙虾模式底部模型区域新增执行方式选择，支持中英文文案，并按任务记录恢复已固化的执行方式。
- 经典主任务抽取：把现有主任务规划/复核逻辑抽出为经典主从分支，降低接入辩论分支的风险。
- 辩论编排：实现默认 4 个参与者的独立观点产物、交叉质询摘要、共识汇总和 `decision.json` 输出。
- 共识校验与恢复：校验阻塞性异议、参与者完成状态、决策合法性、恢复规则和 `needs-review` 降级路径。
- 文档、测试与构建验收：补充必要单元测试、构建验证、手工验证说明，并同步功能清单和能力规格。

## 非目标

- 不新增顶层 `coding / plan / lobster` 之外的交互模式。
- 不重写 `runLobsterSubtasksBatchWithRetry`、`lobsterParallel` 或现有子任务执行器。
- 不实现跨进程、跨机器或远端服务的多智能体系统。
- 不新增“辩论模型”选择；第一版辩论参与者复用主任务模型。
- 不让辩论参与者直接修改仓库业务文件；参与者只读上下文并写自己的辩论 artifact。
- 不在第一版实现复杂可视化图谱或动态角色选择。

## 验收标准

- [x] 龙虾模式中可选择 `主从多智能体` / `Main/Sub Multi-Agent` 或 `辩论多智能体` / `Debate Multi-Agent`。
- [x] 新建龙虾任务记录能固化 `executionMode`；执行中切换 UI 不改变已创建任务。
- [x] 老任务记录没有 `executionMode` 时按 `main_sub_multi_agent` 处理，恢复老任务不会进入辩论模式。
- [x] 选择 `main_sub_multi_agent` 时，现有主从多智能体行为保持不变。
- [x] 选择 `debate_multi_agent` 时，每轮派发子任务或完成判断前至少 4 个默认参与者完成规划/审查 artifact。
- [x] 每轮辩论在 `lobster-communications/<taskId>/debates/round-<n>/` 下生成 `brief.md`、`participants/*.md`、`cross-review.md`、`consensus.md` 和 `decision.json`。
- [x] 派发子任务前必须存在共识记录，且 `consensus.md` 与 `decision.json` 均可追溯到参与者 artifact。
- [x] 存在未解决阻塞性异议、参与者缺失、非法 JSON 或子任务 prompt 不自包含时，不派发子任务，任务进入 `needs-review` 并写明原因。
- [x] 共识通过后，`applyLobsterMainDecision`、子任务批次并发、冲突分组、重试和子任务沟通文件继续复用现有链路。
- [x] 最终完成仍要求主任务对话存在 `lobsterFinalSummary=true` 的最终总结气泡。
- [x] Webview 新增文案完整支持中英文，Claude 下执行方式仍可见但模型选择保持原有隐藏规则。
- [x] 文档、功能清单和构建验证全部完成。

## 影响面

- 代码目录：`src/extension.ts`、`src/lobsterParallel.ts`、`src/webview/viewContent.ts`、`src/webview/types.ts`、`src/cli/types.ts`、`src/i18n.ts`，以及实现过程中抽出的龙虾协议/校验辅助模块。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`；如运行时行为或架构边界变化，还需同步 `ARCHITECTURE.md`、`.ch/docs/references/cli-runtime-reference.md` 或 `.ch/docs/design-docs/vscode-cli-extension-runtime.md`。
- 配置与脚本：不计划新增运行时依赖；如新增测试入口或脚本，必须沿用现有 Node/TypeScript 工具链并通过构建验证。

## 风险与缓解

- 风险：辩论编排侵入现有龙虾主从链路，导致主从模式回归。
- 缓解：先抽出经典主任务决策函数，并以 `executionMode` 做显式分支；补充主从模式回归验证。

- 风险：共识汇总重新变成单点决策，无法证明多参与者参与。
- 缓解：要求共识读取并引用所有参与者 artifact；缺少任一默认参与者或存在未解决 `block` 时禁止继续。

- 风险：辩论失败、重试或恢复状态不一致，导致重复派发或跳过派发。
- 缓解：辩论轮记录包含状态、artifact 路径和 `decision.json`；恢复时优先复用已完成决策，缺少共识或 artifact 时重跑该 debate round。

- 风险：UI 新增执行方式与模型选择耦合，导致 Claude 或旧任务恢复显示异常。
- 缓解：执行方式控件独立于模型选择能力；任务创建时固化 `executionMode`，恢复以任务记录为准。

- 风险：辩论参与者误改仓库文件或写入范围冲突。
- 缓解：参与者 prompt 明确只读仓库和任务记录、只写指定辩论 artifact；第一版可在编排前后检查工作区 diff 并在异常时进入 `needs-review`。

- 风险：辩论成本和耗时显著增加。
- 缓解：第一版固定 4 个参与者，只做一轮独立观点和一次共识汇总，不实现多轮真实交叉质询。

## 验证计划

- 最小相关验证：新增或更新协议归一化、路径生成、共识校验相关单元测试；运行项目现有构建命令 `npm run build`。
- 扩展验证：人工在 VS Code 面板选择龙虾模式和 `辩论多智能体`，发送可拆分任务，确认主 tab 出现辩论状态消息，沟通目录生成辩论文件，共识后仍按现有子任务批次执行。
- 回归验证：人工验证 `主从多智能体` 行为不变；验证老任务缺少 `executionMode` 时按主从恢复；验证 Claude 下执行方式可见且模型选择仍按原规则隐藏。
- 故障验证：构造未解决阻塞性异议、缺少参与者 artifact、非法 `decision.json`、`status=continue` 但无 `subtasks` 的场景，确认不会派发子任务并进入 `needs-review`。

## 测试与清单同步

- 单元测试：优先覆盖 `normalizeLobsterExecutionMode`、辩论路径生成、辩论记录归一化、共识校验、`normalizeLobsterMainDecision` 对可选 `debate` 元数据的兼容解析。
- 功能清单：实现完成时同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：实现完成时同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`；如行为、接口、架构或运行时恢复规则发生变化，同步 `ARCHITECTURE.md`、`.ch/docs/references/cli-runtime-reference.md` 或 `.ch/docs/design-docs/vscode-cli-extension-runtime.md`。

## 任务列表

- [x] 协议/记录：新增 `LobsterExecutionMode`、默认值、任务记录字段、辩论记录类型、路径生成和老任务兼容规则。
- [x] Webview 设置：新增龙虾执行方式选择、按 CLI 记忆、发送 prompt 携带执行方式、恢复任务时以任务记录同步 UI，并补齐中英文文案。
- [x] 经典主任务抽取：已抽成 `runClassicLobsterMainDecision` 或等价函数，`main_sub_multi_agent` 继续走经典主任务规划/复核链路。
- [x] 辩论编排：第 3 批已落地第一版 `runLobsterDebateRound`，生成 `brief.md`、4 个参与者 artifact、`cross-review.md`、`consensus.md` 和 `decision.json`。
- [x] 共识校验/恢复：fresh run 的共识校验和 `needs-review` 降级已接入；第 5 轮已修复恢复复用路径，复用 `decision.json` 前要求 `cross-review.md` 非空，且 `consensus.md` 必须可解析为结构合法的 `LobsterDebateConsensusRecord` 并通过 `validateLobsterDebateConsensus`。
- [x] 文档同步：第 4 批已同步功能清单、能力规格、运行时参考和必要架构文档。
- [x] 最终构建验收：第 6 轮复验 `npm run build`、`node --test dist/test/lobsterDebate.test.js` 和指定 `git diff --check` 全部通过；真实 VS Code 面板端到端验证未执行，不能标记为通过。

## 进度记录

- 2026-06-16 第 1 批已完成执行计划创建：本文件已建立，创建时状态为 `in-progress`。
- 2026-06-16 第 1 批已完成协议纯函数基础：`LobsterExecutionMode`、`DEFAULT_LOBSTER_EXECUTION_MODE`、`normalizeLobsterExecutionMode`、`src/lobsterDebate.ts` 辩论记录/路径/共识校验纯函数，以及 `src/test/lobsterDebate.test.ts` 单测；子任务报告显示 `npm run build` 与 `node --test dist/test/lobsterDebate.test.js` 通过。
- 2026-06-16 第 1 批已完成 Webview 执行方式入口：龙虾模式可选择 `main_sub_multi_agent` / `debate_multi_agent`，前端按 CLI 记忆并在 `sendPrompt` 携带 `lobsterExecutionMode`，新增文案已覆盖中英文；子任务报告显示 `npm run build` 通过。
- 2026-06-16 第 2 批已完成 `src/extension.ts` 运行时接线：持久化 `lobsterExecutionMode.<cli>`，`PanelState` 回传覆盖 `CLI_LIST` 的 `lobsterExecutionModeByCli`，`sendPrompt` 仅在 `lobster` 模式携带执行方式，新建 `LobsterTaskRecord` 固化 `executionMode`，老任务缺字段默认 `main_sub_multi_agent`，并预留/保留 `debateRounds`；子任务报告显示 `npm run build` 通过。
- 2026-06-16 第 2 批已建立 `debate_multi_agent` 显式分支骨架：完整辩论编排接入前会进入 `needs-review`，不会静默回落到经典主任务规划；经典主任务函数抽取仍留到辩论编排批次。
- 2026-06-16 第 3 批已完成经典主任务抽取和第一版 `runLobsterDebateRound` 编排：`debate_multi_agent` 不再是占位分支，辩论共识通过后复用既有 `applyLobsterMainDecision` 与子任务批次链路。
- 2026-06-16 第 4 批已完成产品/运行时文档同步：功能清单、能力规格、运行时参考和必要架构文档已记录 `debate_multi_agent`、`executionMode`、`debateRounds`、artifact 与恢复边界。
- 2026-06-16 第 4 批独立运行时验证结论为 `needs-fix`：`npm run build`、`node --test dist/test/lobsterDebate.test.js` 和指定 `git diff --check` 均通过，但恢复复用路径存在两个阻塞缺陷。
- 2026-06-16 第 5 轮已修复阻塞缺陷 1：恢复复用路径不再通过 `buildRecoveredLobsterDebateConsensus` 或任务记录里的 recorded consensus 替代损坏的 `consensus.md`；`consensus.md` 不可解析或结构非法时会重跑该辩论轮，不派发子任务。
- 2026-06-16 第 5 轮已修复阻塞缺陷 2：恢复复用已有 `decision.json` 前会校验 `cross-review.md` 存在且非空；缺失或空文件会重跑该辩论轮，不派发子任务。
- 2026-06-16 第 6 轮最终复核通过：静态复核确认 round-5 恢复修复仍满足失败/恢复边界，且 `buildRecoveredLobsterDebateConsensus`、`getRecordedLobsterDebateConsensus` 等替代损坏 `consensus.md` 的可派发路径不存在。
- 2026-06-16 第 6 轮验证命令通过：`npm run build`、`node --test dist/test/lobsterDebate.test.js`（6/6 pass）和指定 `git diff --check` 均通过。
- 2026-06-16 真实 VS Code 面板端到端验证未执行；本计划不将该项标记为已通过，后续如需发布前人工验收应单独记录。

## 决策记录

- 2026-06-16：采用设计文档方案 C：辩论式规划，复用现有子任务执行。
- 2026-06-16：默认执行方式保持 `main_sub_multi_agent`，避免改变现有用户和老任务行为。
- 2026-06-16：`debate_multi_agent` 只替代主任务规划/复核阶段；辩论完成后仍输出现有 `LobsterMainDecision` JSON。
- 2026-06-16：子任务派发、批次并发、冲突分组、重试、沟通文件和最终总结气泡复用现有链路。
- 2026-06-16：老任务缺少 `executionMode` 时按 `main_sub_multi_agent` 处理；新建任务创建时固化执行方式，恢复时以任务记录为准。
- 2026-06-16：第一版固定 4 个默认参与者：架构规划者、实现拆分者、测试验收者、风险审查者；不做动态角色选择。

## 当前结论

执行计划已完成并可归档。第 1 批至第 5 轮已完成计划创建、协议/Webview 基础、`extension.ts` 执行方式接线、经典主任务抽取、第一版 `runLobsterDebateRound` 编排、产品/运行时文档同步，以及恢复复用失败边界修复。第 6 轮最终复核确认：复用 `decision.json` 前必须存在非空 `cross-review.md`，`consensus.md` 必须可解析为结构合法的 `LobsterDebateConsensusRecord` 并通过 `validateLobsterDebateConsensus`，不存在 recorded/recovered consensus 替代损坏 `consensus.md` 的可派发路径。第 6 轮 `npm run build`、`node --test dist/test/lobsterDebate.test.js` 和指定 `git diff --check` 均通过。真实 VS Code 面板端到端验证未执行，后续发布前如需要人工验收应单独补记。
