# 经典 Loop 复用子任务验证结果

- 日期：2026-11-11
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-11
- claim_ttl：当前任务
- handoff_to：无

## 背景与目标

普通 Loop 提示词将用户或项目要求的验证一律解释为独立验证子任务，导致实现子任务已完成验证后仍重复派发。本次区分“要求验证”和“要求独立验证”，优先信任并复用当前有效的子任务汇报。

## 范围与非目标

- 修改经典 Loop 主任务和子任务提示词，更新现有回归测试与对应事实来源。
- 不改变 Loop+、完成协议、状态机、会话复用或子任务隔离；不新增验证门禁或自动判断测试结果的规则引擎。
- 工作区已存在相关未提交修改，采用保留式增量编辑；不创建分支或工作树，以免丢失当前未提交的行为基线。

## 验收标准

- 子任务明确汇报已通过且覆盖当前改动的验证时，主任务采信结果，不因要求验证而另派重复任务。
- 子任务可在实现过程中按用户或项目规则完成必要验证，汇报范围、命令或操作、结果及未完成项。
- 部分覆盖时只补缺失或失败项；后续改动导致失效时只补受影响项。不得无理由整套重跑。
- 汇报不清时优先续接来源子任务补充说明，不把缺少报告细节直接解释为必须重测。
- 用户或项目明确要求独立验收、交叉复核时，仍另派相应任务；未覆盖的实现后集成验证只补相应缺口，普通验证要求不等于独立验证要求。
- 已有满足独立要求且仍有效的验收汇报也直接复用，不在每次主任务唤醒后重新派发独立验收。
- 无验证要求时不增加验证；主任务仍不亲自测试或检查实现；Loop+ 不受影响。

## 影响面与风险

- 代码：`src/extensionHost/loopOrchestration.ts`、`src/loopTaskStore.ts` 的经典提示与沟通模板分支。
- 测试：`src/test/extensionHost/subtaskCliExecution.test.ts`、`src/test/loop/loopTaskStore.test.ts`，覆盖各主任务轮次、各 CLI 子任务的新建与会话续接，以及默认旧记录、经典和 Loop+ 模板边界。
- 文档：架构、功能清单、能力分册及 ontology 中经典 Loop 汇报驱动规则。
- 风险：仅通过提示词约束模型，不对自然语言报告做机械真伪判断；保留独立验收要求与过期结果补测边界。

## 验证计划

- 先更新提示词断言，用原实现复现失败，再修改实现并运行定向测试。
- `npm run build`。
- `node --test dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/extensionHost/promptExecutionShared.test.js dist/test/extensionHost/loopTaskStateMachine.test.js dist/test/loop/loopFinalSummary.test.js dist/test/loop/loopTaskStore.test.js dist/test/loop/loopTaskStoreCoreCoverage.test.js`。
- 扩大到 Loop+ 提示与协议相关回归，确认未改变其要求。
- ontology 结构校验、skill 单测、定向空白检查与 `git diff --check`。
- 无 UI、路径、CLI 参数或用户配置变更，不运行浏览器、不调用真实付费模型；模型实际决策是否遵守提示词不由单元测试保证。

## 任务列表

Tasklist:
- [completed] 核对实现与回归测试入口
- [completed] 调整验证复用与补充派发规则
- [completed] 同步文档并完成构建验证

## 决策与文档同步

- 将复用规则放入现有经典主子任务提示词，不复制到 Loop+ 或新增配置开关。
- 扩大检查发现沟通文件模板也有强制独立派发提示，已同步修正经典与默认旧记录分支；Loop+ 模板原样保留。历史沟通文件不改写，主任务明确不将历史模板的默认要求视为用户或项目的独立验收要求。
- 稳定规则同步到现有事实来源与 ontology；不重复写入热区记忆、事件记忆或历史计划。

## 验证结果

- 红灯复现：更新主任务提示词断言后，`npm run build` 通过；`node --test --test-name-pattern='classic Loop reuses reported verification' dist/test/extensionHost/subtaskCliExecution.test.js` 按预期失败，旧提示缺少“已验证则复用”规则。日志：`/tmp/sinitek-classic-loop-verification-red.log`。
- 最终 `npm run build` 通过。
- 最终定向及兼容回归共 179 项，全部通过，无失败或跳过。命令：

```bash
node --test \
  dist/test/extensionHost/subtaskCliExecution.test.js \
  dist/test/extensionHost/loopMainDecisionParsing.test.js \
  dist/test/extensionHost/promptExecutionShared.test.js \
  dist/test/extensionHost/loopTaskStateMachine.test.js \
  dist/test/loop/loopFinalSummary.test.js \
  dist/test/loop/loopTaskStore.test.js \
  dist/test/loop/loopTaskStoreCoreCoverage.test.js \
  dist/test/extensionHost/loopPlusPromptBuilders.test.js \
  dist/test/loop/loopPlusDecision.test.js \
  dist/test/loop/loopPromptBuilders.test.js \
  dist/test/loop/loopTaskMessagePolicy.test.js \
  dist/test/loop/loopSubtaskSession.test.js
```

- 日志：`/tmp/sinitek-classic-loop-verification-final-tests.log`。覆盖经典主任务多轮提示、各 CLI 新建及续接子任务、默认旧记录与经典沟通模板、已有报告保留、Loop+ 模板/提示/决策兼容、完成协议及会话绑定。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 的 9 项测试通过。
- 对本次修改的代码、测试、文档、ontology 与计划运行 `node scripts/check_trailing_whitespace.js <文件列表>`，无发现；`git diff --check` 通过。
- 更新架构、能力分册、功能清单及 ontology 中相关概念/规则，并增加沟通模板与回归测试事实来源。无需修改运行时设计入口、memory 热区或事件记忆；稳定结论已在事实来源维护。
- 没有修改 Loop+ 生产逻辑、用户配置、持久化历史报告，也未运行发布脚本。本次未启动浏览器、完整 Extension Development Host 或真实模型，模型实际派发效果仍需加载更新插件后的任务验证；自动化验证不宣称自然语言汇报的真实性或模型每次遵从性。

## 当前结论

优化已交付：普通 Loop 优先复用当前有效的子任务验证汇报，只补缺口或受影响部分；明确要求独立验收时仍满足要求，已有效完成的独立验收不再重复派发。历史模板不形成新的独立验收要求，主任务不亲自测试，Loop+ 不变。构建与 179 项回归及 ontology 校验通过；加载更新插件后的新一轮主任务判断使用新规则，不自动取消已派发的任务。
