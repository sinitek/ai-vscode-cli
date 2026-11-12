# Loop 与 Loop+ 连续子任务会话复用 — 新功能开发

- 日期：2026-10-31
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-31-loop-subtask-session-reuse.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-31-docs-loop-subtask-session-reuse.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

按真实运行记录复用连续子任务会话，保持配置边界与并发隔离。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-31-feature-loop-subtask-session-reuse.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 目标与范围

- 主模型显式声明连续任务来源，宿主从同一父任务的真实运行记录恢复子模型会话，不接受模型提供任意 sessionId。

- Loop+ 对同一子任务的验收失败修补和 reprompt 默认复用原会话；独立新任务保持新会话。

- 经典 Loop 保留汇报驱动与按用户、项目要求独立派发验证；不恢复主模型验收流程。

- 不覆盖工作区既有修改，不改技术栈或依赖，不创建分支或 worktree。

## 验收标准与风险

- 经典 Loop、Loop+ 决策均支持显式连续任务来源；提示词说明何时复用、何时隔离。

- 同一 CLI 与配置下优先恢复原 session；来源不存在、无有效会话或配置不兼容时给出可观察原因，不跨父任务或跨 CLI 误用。

- 同一个会话不同时执行多个子任务；保留写入冲突、停止、续跑和 Loop+ 验收机制。

- 已完成 Tab 可以关闭，连续任务仍能从持久运行记录恢复会话。

## 验证与文档

- 同步能力清单、模式规格、设计及 ontology；对既有范围外失败记录证据，不扩大修复。

- 真实 CLI 会话续接差异与临时执行目录边界需明确记录未覆盖风险。

## 进展与结果

- 经典 Loop 和 Loop+ 决策新增 `continueFromSubtaskId`；由主模型显式判断连续任务，宿主仅从同一父任务记录恢复会话，不按标题或文件名猜测。

- 新增共享 `src/loopSubtaskSession.ts`，统一来源解析、绑定校验、失败修补继承、持久化更新及排序执行租约。

- 子任务保存真实 CLI/session/config 绑定；完成后关闭 Tab 不清除绑定。连续工作可以创建新 Tab 并恢复原 CLI 会话，独立任务保持新会话。

- Loop+ 通过失败 `reviews[*].reviewEventId` 定位原子任务，再将 `subtaskIds` 指向的修补项自动关联原会话；显式来源保留，多个失败来源有歧义时不擅自选择。`controls.reprompt` 保存并续接原子任务会话。

- CLI、配置不兼容或旧记录缺失有效绑定时新建会话并记录原因；路由未指定配置时补齐目标 CLI 当前配置，并传给实际执行，避免缺省值与真实绑定误判不兼容。

- 真实执行入口补存实际会话和配置；适配器不得用缺省配置覆盖实际执行配置。停止前保存已有绑定，旧 attempt 迟到结束不由适配器覆盖新绑定。

- 同一来源子任务或会话串行运行，初次尚未取得 sessionId 的任务也锁定自身身份；不同独立任务仍可并发。主提示要求等待来源完成，运行中调整使用控制重派。

- 保留经典 Loop 汇报驱动和按用户、项目要求独立派发验证；保留 Loop+ 验收与调度门槛。

## 已执行验证

- `npm run build`：最终通过，TypeScript 构建成功。

- 最小回归：`node --test dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/loop/loopSubtaskSession.test.js`，39/39 通过。

- 核心保护回归：相关测试文件组合通过，日志 `/tmp/loop-session-reuse-tests.log`：

```sh
node --test \
  dist/test/loop/loopSubtaskSession.test.js \
  dist/test/extensionHost/promptExecutionShared.test.js \
  dist/test/extensionHost/loopMainDecisionParsing.test.js \
  dist/test/extensionHost/subtaskCliExecution.test.js \
  dist/test/extensionHost/extensionHostExtractionContracts.test.js \
  dist/test/loop/subtaskDesignBriefPolicy.test.js \
  dist/test/loop/loopTaskStore.test.js \
  dist/test/loop/loopFinalSummary.test.js \
  dist/test/loop/loopGroupChat.test.js \
  dist/test/webview/loopPlusModeHelp.test.js \
  dist/test/extensionHost/loopPlusOrchestration.test.js \
  dist/test/extensionHost/loopPlusRuntimeIntegration.test.js \
  dist/test/extensionHost/loopPlusRuntimeWiring.test.js \
  dist/test/extensionHost/loopPlusPromptBuilders.test.js \
  dist/test/extensionHost/loopPlusDecisionStrategies.test.js \
  dist/test/loop/loopPlusDecision.test.js \
  dist/test/loop/loopPlusScheduler.test.js \
  dist/test/core/loopPlusAcceptancePlan.test.js \
  dist/test/extensionHost/loopTaskStateMachine.test.js
```

- 路由补充：`node --test dist/test/loop/subtaskCliRoute.test.js`，5/5 通过。

- `git diff --check`：通过；新增 helper、测试、设计与计划无尾随空白，均有文件结尾换行。

- 本机最小 CLI smoke：`codex --version` 为 `codex-cli 0.164.0`，`codex exec resume --help` 确认支持 session ID；`opencode --version` 为 `1.18.35`，`opencode run --help` 确认支持 `--session` 和 `--dir`。只读取帮助，不发送模型请求或修改用户已有会话，日志 `/tmp/loop-session-reuse-cli-smoke.log`。

## 失败分流与处理

- 新执行租约暴露集成夹具跨测试重复 `loop-plus-1` 等父任务 ID，前一测试未结束的 parked attempt 阻塞下一夹具；归类为夹具隔离问题。改为使用夹具唯一临时目录身份构造父任务 ID，真实运行串行锁不放宽，最终相关测试通过。

- `node --test dist/test/webview/loopPlusFullstackMode.test.js`：11/12 通过，剩余既有静态文案断言期待 `子模型使用擅长前端编码的模型`，当前工作区既有文案是 `使用擅长前端编码的模型`。本次未修改相关文案和断言；日志 `/tmp/loop-session-reuse-fullstack-tests.log`。

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：仅两处既有失效引用：`plugin.rule.dsh_profile_edit` 指向用户已删除的 `completed/2026-10/2026-10-26-dsh-config-import-visual-empty.md`，`plugin.rule.loop_plus_role_model_routing` 指向已归档的 `active/2026-10-31-loopplus-role-model-routing.md`。本次新增会话复用规则无新增校验问题；不恢复用户删除文件、不扩大修改无关规则。

- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：8/9 通过，唯一失败为上述当前仓库本体引用校验。日志 `/tmp/loop-session-reuse-ontology-tests.log`。

- 一次 shell 汇总命令误用 zsh 只读变量 `status`；改用 `rc` 后重跑并取得真实测试结果，与产品逻辑无关。

## 文档与记忆收尾

- 稳定设计已沉淀到 `.ch/docs/design-docs/loop-subtask-session-reuse.md`。

- 依照 `.ch/docs/MEMORY.md`，设计与失败证据已由设计文档、本体和本计划承载，不重复扩写热区，不写自动任务记录到 `ROLLING_SUMMARY.md`。

- 保留所有用户既有未提交修改与删除，不创建提交、分支或工作树。

## 未覆盖与当前结论

- 已完成实现、模拟集成、构建和相关模式保护回归；不宣称全仓库所有检查通过。

- 未启动 Extension Development Host 做真实付费模型多轮续接。不同 CLI 对已删除会话、历史临时 cwd、模型切换和配置变更的实际兼容性仍需真实环境端到端验证；CLI 帮助 smoke 不能替代该验证。

- 来源应先完成再派发后续工作；来源尚无绑定时不会提前推测未来 session。运行中改派使用已有 `controls.reprompt`，等待租约时被取消的任务在获得租约后检查取消状态，不再发起 CLI 请求。

- 会话复用是可恢复绑定兼容时的默认策略，不跨父任务、CLI 或配置强行续接。缺失会话等异常降级有记录，不假报恢复成功。
