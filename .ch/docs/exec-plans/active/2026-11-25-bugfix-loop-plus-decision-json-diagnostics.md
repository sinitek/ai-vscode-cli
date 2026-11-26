# Loop+ 主决策 JSON 格式诊断

- 日期：2026-11-25
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/active/2026-11-25-feature-loop-plus-subtask-acceptance-standards.md`（共同背景为 Loop+ 决策与交付可靠性；本计划区分拒绝类别并留存安全诊断，不更改独立验收责任）
- 状态：in-progress
- 负责人：Codex / 人类 / 协作
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

Loop+ 决策可靠性修复覆盖格式、字段与宿主状态三个拒绝来源。2026-11-25 留存的两次历史暂停分别涉及未知验收关联与开放批次下的普通派发。问题首次出现于 `1.9.x` 的说法仍待版本与原始故障证据核实。长期分阶段方案见 [lp318 方案](../../../../docs/LOOP_PLUS_DECISION_RELIABILITY.md)，该文件沿用其独立交付边界。

## 目标

让主模型根据当前宿主状态选择可用形状，给拒绝提供可执行的受控修正信息，在一次自动续跑预算内保留冻结验收、报告 FIFO、真实结论、失败返工与完成门禁。

## 范围

- 阶段 0 已实现解析器字段诊断和宿主 `format`、`validation`、`state` 分类。解析器与续跑提示使用合法分类 `backend`、`frontend`、`general`；返工提示按实际失败 review 逐项处理，并区分同 ID 返工与 `independentSubtaskIds` 独立工作。安全观测以受控原因码、字段路径和续跑结果为主。
- 阶段 1–2 已实现从冻结 step 和调度快照派生的提示示例，涵盖单项/多项验收、仅报告回执、一次性验收前窗口和完成资格。宿主应用预检与调度器继续决定是否落地。
- 阶段 3 保留已接通的各 CLI 原生参数、会话、压缩、用量和输出传输差异，当前对各自提取的文本使用共同解析；本次重构不压平或增强 CLI 能力。原生模型决策 schema 支持、版本、流式结果及错误语义待逐个适配器核实。见[调度设计](../../design-docs/loop-plus-scheduling.md#cli-输出与会话能力)。
- 阶段 4 当前工作树候选已实现有界续跑：连续拒绝最多自动请求三次新决策；第四次连续拒绝进入 `needs-review`。初次拒绝计失败但不占三个自动请求名额。有效决策或获准的用户显式继续清零；部分接受和自动续跑不清零，旧暂停记录缺少受控原因码时回退安全提示。分级启用、恢复率、重复拒绝率与留存策略仍待验证。
- 本轮同步[调度设计](../../design-docs/loop-plus-scheduling.md#状态感知决策形状)、[功能清单](../../product-specs/FEATURE_INVENTORY.md#loop-协议失败自动续跑)与[运行时本体](../../ontology/domains/cli-plugin-runtime.json)。

## 非目标

- 不改源码或 JSON/JSONC 解析兼容规则。
- 不放宽字段、子任务验收关联、冻结批次、报告确认、依赖、权限或完成门禁。
- 不回灌被拒绝原始回复，也不记录可能包含敏感内容的自由文本诊断。
- 不把格式错误和语义/调度协议校验失败混为一谈。
- 不发布，不运行发布脚本；本次文档修正不改版本文件，也不执行 Git 提交或推送。

## 验收标准

- [ ] 独立验收三类拒绝、合法分类及受控修正提示，覆盖格式行列、旧暂停兼容和安全观测。
- [ ] 独立验收冻结批次、报告 FIFO、开窗派发预检、失败返工及全局完成门禁，确认状态示例与应用时权威一致。
- [ ] 独立验收初次拒绝后最多三次自动请求、第四次连续拒绝暂停、部分接受保留进度和计数、显式继续重置、取消边界及安全日志字段。
- [ ] 对同一稳定候选完成 macOS 检查、全量回归和隔离 Extension Development Host 激活及面板烟测；旧断网场景单独记录，不以普通隔离启动代替。
- [ ] 在真实隔离宿主验证通过后，将可复用的验证步骤和注意事项沉淀为技能/流程知识。
- [ ] 必要验收通过后，核准交付文件与差异、分支及远端，仅在经审查的范围内提交和推送，并记录提交 SHA 与推送结果。

## 影响面

- 代码目录：无，本计划记录已完成的前置源码交付。
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/`、`.ch/docs/exec-plans/active/`。
- 配置与脚本：无。

## 风险与缓解

- 三项前置实现已修复分类提示和失败/独立工作的归属文案；前置报告的定向测试覆盖这些案例。主任务仍需独立审查共享候选及并行改动，不能将单次尝试结果视为最终验收。
- 当前 `loop-plus-protocol-miss.dispatchWindow` 由导致拒绝的 step 的宿主 `allowDispatchBeforeReview` 提供。拒绝后同一 consumer 再规划下一 step；重试不保证复用上一 step 或仍开放的一次性窗口。灰度观测与效果指标仍待验证。
- 连续拒绝链最多自动请求三次，不是父任务全局决策上限；第四次拒绝暂停。停止、确认 runner 取消、释放或完成均阻止后续续跑。协议拒绝日志另含 `held`、`dispatchWindow` 和可选白名单 `fieldPath`；恢复日志区分请求、暂停、清除和显式继续，`continuation_requested` 不证明模型已启动。两类日志均不含 prompt、回复正文、自由文本拒绝理由、凭据或本地路径。继续审查取消与 shared-worktree 状态边界。

## 验证计划

- lp333 与 lp399 的源码检查各对应独立快照，不能合并为当前候选或最终验收结论。lp399 报告记录预算新回归 2/2、暂停记录 6/6 通过，也记录一个旧编排兼容用例失败及编排测试 Promise 未决后中断；准确命令与覆盖见相应尝试报告。本轮本体与文档检查结果见本轮尝试报告。
- 独立主审核对最终候选的 `runConsumer` 拒绝后重新 `planStep`、冻结 review 前缀复用、一次性派发窗口与并发停机/取消边界，再安排 macOS 检查、全量单测与隔离 Extension Development Host 激活及面板烟测；macOS 验证仍未完成。
- 旧历史断网 Extension Host 场景独立跟踪。lp76 在 workbench 就绪前出现 renderer `crashed`/6，lp269 排查时未启动宿主。网络与真实 HOME 拒绝、历史按钮/中文标题、协议提示隐藏、自定义标题保护、session-store 持久化及清理仍缺同次实测。普通隔离启动只覆盖激活及面板。历史证据见 [CLI 运行时计划](2026-11-24-refactor-cli-runtime-policy-convergence.md)。

## 测试与清单同步

- lp319（`round-322-loopplus-subtask-field-rejection-diagnostics.md`）隔离 `npm run build -- --outDir .tmp/loopplus-field-diagnostic-repair/dist` 通过，`node --test .tmp/loopplus-field-diagnostic-repair/dist/test/loop/loopPlusDecision.test.js` 通过 48 项，覆盖合法分类修复后重解析及字段分支。
- lp320（`round-322-loopplus-state-aware-decision-contract.md`）完整 TypeScript 编译通过，定向契约与提示构建 58 项通过，宿主开窗及依赖拒绝用例 2 项通过。相邻策略、解析及调度组当时 134 项通过、10 项失败，失败集中在仍期待旧 `protocolMiss` 接口的策略测试。
- lp321（`round-322-loopplus-bounded-protocol-recovery.md`）`npm run build` 通过。`node --test --test-reporter=spec dist/test/loop/loopPlusProtocolRepair.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusOrchestration.test.js` 通过 236 项，覆盖更新后的策略断言及恢复、队列和门禁。lp320 的历史失败及各自构建快照均保留，组合后的最终候选待集成核对。
- lp333 的四份交付文档以 [Loop+ 调度设计](../../design-docs/loop-plus-scheduling.md#协议失败后的自动续跑) 核对单次恢复交付基线。前置命令与原文档检查结果见 lp333 报告，不视为后续恢复行为的验收结论。

## 任务列表

- [x] 对照三份前置报告和当前源码，区分已实现、已有执行证据和待验收范围。
- [x] 同步状态形状、宿主门禁、诊断、各 CLI 能力与本体来源。
- [x] 完成本体、文档结构、引用及补丁检查，结果记录于本次执行报告。
- [ ] 由主任务独立验收共享实现，核对恢复提示、窗口观测与并行改动。
- [ ] 对同一稳定候选完成 macOS 检查、全量回归及隔离 Extension Development Host 验证。旧断网检查保留专项记录。
- [ ] 沉淀本次可靠性修复的技能/流程知识；尚未完成，不据此宣称已沉淀。
- [ ] 待必要验收完成并审定交付范围、分支与远端后，仅提交和推送获准的差异，记录交付结果。

## 决策记录

- 2026-11-25：原计划的格式诊断沿用既有 JSON 兼容和业务接受条件。当时 `plugin.rule.loop_plus_protocol_repair` 的来源覆盖原有诊断。
- 2026-11-26：三项前置实现完成后，更新原规则并新增 `plugin.rule.loop_plus_state_aware_decision_shape`，引用当前诊断、提示投影、宿主及回归源码。此次同步更正连续拒绝预算、step 重新规划边界、日志字段和未发布候选状态；保留 1.9.x 历史根因未知，不改写为已证事实。

## 当前结论

计划保持 `in-progress`。前置报告记录了各自快照的构建及定向检查，其中 lp320 曾报告相邻策略套件 10 项失败，lp321 后续组合检查记录 236 项通过；这些不同快照的结果不合并为当前候选通过结论。主任务独立验收、macOS Extension Development Host 集成、技能沉淀、灰度观测及阶段 3 的原生 schema 核查仍在途。

`1.10.4` 是旧方案。用户后续提出 `1.10.5`，主通信记录已将其列为候选；当前工作树 `package.json` 为 `1.10.5`，`HEAD` 中仍为 `1.10.3`。`1.10.5` 是未提交、未发布的工作树候选。最终 macOS 全量回归与隔离宿主证据、技能沉淀和经审定的 Git 提交推送均待完成。不发布，不运行发布脚本。
