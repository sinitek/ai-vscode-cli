# Loop+ 复用验证结果并保留验收审查

- 日期：2026-11-11
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-11
- claim_ttl：当前任务
- handoff_to：无

## 背景与目标

Loop+ 当前主提示要求不把子任务声明当作证据，同时无条件允许主模型测试或启动产物，容易重复已完成的验证。改为信任子任务具体执行结果，主模型继续独立判断实现、契约、改动合理性、遗漏/边界和用户选择的附加审查；测试通过不等于全部验收通过。

## 范围与非目标

- 修改 Loop+ 主子任务提示、Loop+ 沟通模板及对应回归断言；同步调度设计、功能清单、能力分册及 ontology。
- 不修改经典 Loop、验收 JSON 字段、六项固定清单、附加审查配置、调度器、完成门禁、失败修复和会话恢复逻辑。
- 工作区含已有未提交修改，保留式增量编辑，不创建分支或工作树，不覆盖已有行为基线。

## 验收标准

- 信任子任务明确汇报的测试、构建和启动结果，覆盖当前改动且仍有效时直接复用，不自行重跑也不另派复现任务。
- 主模型仍审查当前待验收事件的相关代码、差异或交付物，逐事件判断六项固定验收与已选附加项；自测成功或“全部完成”不替代审查结论。
- 补充检查仅针对未覆盖、失败、后续修改失效的部分或明确独立验证要求；先说明已有结果、具体缺口和最小范围。已有效完成的独立检查也复用。
- 汇报不清先补说明，不机械索要原始日志或因缺少细节直接重跑。收尾/续跑复用已验收且未变化的结果，保留最终需求覆盖及开放事件门禁。
- 子任务汇报范围、命令或操作、结果、未执行或未覆盖项及相关后续改动，区分自测结果与需主模型审查的事项。
- 两种子任务模式和五类主模型提示均适用；经典 Loop 不变，Loop+ 失败事件不得被报告采信规则改判通过。

## 影响面与风险

- 代码：`src/extensionHost/loopPlusPromptBuilders.ts`、`src/loopTaskStore.ts` 的 Loop+ 沟通模板分支。
- 测试：主子任务提示和跨模式沟通模板；扩大到验收方案、协议、调度与编排回归。
- 风险：信任执行事实不等于结果覆盖完整，也不等于实现正确。通过明确范围、后续改动失效及持续代码审查限制复用，不新增机械报告门禁。
- 自动化只验证提示、模板与既有协议不变；不保证模型每次决策都遵守新提示。

## 验证计划

- 更新回归断言，用原实现复现缺少结果复用规则的失败。
- `npm run build`，随后定向运行 `dist/test/extensionHost/loopPlusPromptBuilders.test.js`、`dist/test/loop/loopTaskStore.test.js`。
- 扩大到 Loop+ 编排/运行时集成/调度/协议/验收方案及经典 Loop 提示相关回归。
- ontology `--validate`、ontology skill 单测、定向空白校验和 `git diff --check`。
- 不变更 UI、CLI 接口或用户配置，不跑浏览器，不调用真实付费模型，不执行发布脚本。

## 任务列表

Tasklist:
- [completed] 核对验收流程与重复验证来源
- [completed] 调整结果复用和审查边界
- [completed] 补充回归测试并同步文档

## 决策与文档同步

- 复用执行事实，保留主模型验收判断，不照搬经典 Loop 的不检查实现策略。
- 维持默认及附加验收字段、事件批次、失败修复和最终完成门禁，避免用可信报告直接自动通过。
- 稳定规则沉淀到既有设计、规格与 ontology，不重复扩写热区或事件记忆。

## 验证结果

- 红灯复现：更新断言后 `npm run build` 通过；`node --test --test-name-pattern='all Loop\+ modes and main prompt kinds reuse' dist/test/extensionHost/loopPlusPromptBuilders.test.js` 在旧实现上按预期失败，缺少采信报告与复用规则。日志：`/tmp/sinitek-loop-plus-acceptance-reuse-red.log`。
- 实现完成后 `npm run build` 通过；主子提示及模板的定向测试 42/42 通过。日志：`/tmp/sinitek-loop-plus-acceptance-reuse-focused.log`。
- 同一构建产物上的扩大回归 370/370 通过，无失败、跳过或取消。命令：

```bash
node --test \
  dist/test/extensionHost/loopPlusPromptBuilders.test.js \
  dist/test/extensionHost/loopPlusOrchestration.test.js \
  dist/test/extensionHost/loopPlusRuntimeIntegration.test.js \
  dist/test/extensionHost/loopPlusRuntimeWiring.test.js \
  dist/test/extensionHost/loopPlusDecisionStrategies.test.js \
  dist/test/loop/loopPlusScheduler.test.js \
  dist/test/loop/loopPlusDecision.test.js \
  dist/test/loop/loopPlusContracts.test.js \
  dist/test/core/loopPlusAcceptancePlan.test.js \
  dist/test/extensionHost/loopPlusAcceptancePlanHost.test.js \
  dist/test/loop/loopTaskStore.test.js \
  dist/test/loop/loopTaskStoreCoreCoverage.test.js \
  dist/test/extensionHost/subtaskCliExecution.test.js \
  dist/test/extensionHost/loopMainDecisionParsing.test.js \
  dist/test/extensionHost/promptExecutionShared.test.js \
  dist/test/loop/loopFinalSummary.test.js
```

- 日志：`/tmp/sinitek-loop-plus-acceptance-reuse-final-tests.log`。新增断言覆盖 fullstack/split、五类主提示、各子角色、六项固定清单与全选附加审查的保留、执行事实复用与不重跑、补充检查边界及主模型不接管实现。模板测试同时验证经典/旧记录规则未改变、Loop+ 保留验收审查和既有报告不被覆盖。
- ontology `--validate` 通过；ontology skill 的 9 项单测通过；已核对验收规则的模板与测试来源路径。
- 对本次代码、测试、设计、规格、ontology 和计划执行定向空白校验，无发现；`git diff --check` 通过。
- 已同步调度设计、能力分册、功能清单和 ontology 的验收清单规则。架构层边界、调度状态与协议未改变，无需改写架构入口或运行手册；稳定规则已留在事实来源，不重复写入热区/事件记忆。
- 未运行发布脚本、真实付费模型、浏览器或完整 Extension Development Host，未修改用户配置或既有报告。回归验证提示与协议边界，不宣称真实模型必然遵从或执行报告天然覆盖全部需求；加载更新插件后的实际派发效果仍需观察。

## 当前结论

优化已完成：Loop+ 采信并复用有效执行结果，主模型保留逐事件交付物审查和已选附加验收；仅针对明确缺口、失败、结果失效或独立要求追加最小检查。收尾与续跑只审新增或受影响内容，固定清单、最终需求覆盖和事件完成门禁不变。构建、370 项相关回归、ontology 校验及其 9 项单测通过；真实模型效果未实测。
