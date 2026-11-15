# Loop+ 验收修复与剩余目标并行推进

- 日期：2026-11-15
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

整体目标尚未完成且没有强写入冲突时，Loop+ 不应只派发验收修复、串行等待后才推进其它交付。现有 accept 示例仅展示单个修复，且所有新任务必须关联验收事件；关联失败事件又会自动继承失败任务会话，混淆修复与独立工作。

## 范围与非目标

修正 accept 协议、提示及示例，允许明确声明独立的剩余目标任务，与验收修复一起派发。保持原验收逐项结论、修复会话复用、文件冲突、容量、完成门禁和旧协议兼容。不变更技术栈、界面、经典 Loop 或外部 CLI 协议。

## 验收标准

- accept 可同时声明修复及独立后续任务；每个新任务恰好归属一个事件或独立任务列表，未知、重复、遗漏关联仍拒绝。
- 修复自动继承失败事件的会话，独立任务不因该验收失败而继承同一会话。
- 可用槽位内无冲突任务一起启动；真实重叠范围、冲突组和容量限制仍生效，独立任务可越过被阻塞任务回填。
- 所有主提示种类及两种子模型模式明确复核剩余需求，示例展示修复与独立交付，不为并行数量制造无意义任务。
- 构建、相关回归与 ontology 校验通过；同步功能清单、调度设计和本体。

## 影响面、风险与缓解

- 源码：src/loopPlusDecision.ts、src/extensionHost/loopPlusPromptBuilders.ts。
- 测试：协议解析、提示生成、Loop+ 编排及子任务会话相关回归。
- 文档：功能清单、Loop+ 调度设计、AI 开发本体。
- 风险：误关联导致会话串用、遗漏链接被接受或冲突保护弱化。通过显式 independentSubtaskIds 和严格唯一归属校验，以及真实调度器编排回归覆盖；不修改冲突算法。
- 回滚：撤销本计划关联的局部改动，无持久化格式迁移。

## 验证计划与记录

- 隔离工作树基线：npm run build 已通过；后续执行原有相关单测。
- 最小命令：npm run build；node --test dist/test/loop/loopPlusDecision.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusOrchestration.test.js。
- 扩展验证：Loop+ scheduler、决策策略、会话复用相关单测；ontology --validate 及 skill 单测；git diff --check。
- 未涉及 UI，不需要浏览器验证；不依赖真实模型输出或用户会话，使用真实宿主编排及 scheduler 的隔离测试，不执行发布脚本。
- 失败处理：按 TESTING.md 区分实现、断言、夹具、环境及历史失败，保留证据。

## 决策记录

- 2026-11-15：CodeGraph 定位后读取当前源码，确认 scheduler 支持 accept 附带多个任务；根因集中在关联协议和提示示例。使用可选 independentSubtaskIds 显式表示不属于当前事件的剩余目标交付，保留旧 reviews[].subtaskIds 行为。
- 2026-11-15：decision-model 对无依赖、无写入冲突且槽位充足的抽象场景分类为 parallel，confidence=0.71；实际实现仍以源码契约和回归证据为准。

Tasklist:
- [completed] 定位派发协议、修复会话继承与并行保护
- [completed] 实现显式独立后续任务并补充回归
- [completed] 完成当前工作区构建、验证记录与归档


## 实施与验证结果

- `npm run build`：隔离工作树基线及实施后均通过。
- `node --test dist/test/loop/loopPlusDecision.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusOrchestration.test.js`：基线 169/169；新增协议、提示及实际宿主调度回归后 177/177。
- 扩展回归：`node --test dist/test/loop/loopPlusScheduler.test.js dist/test/loop/loopParallel.test.js dist/test/loop/loopSubtaskSession.test.js dist/test/loop/loopPlusProtocolRepair.test.js dist/test/loop/loopPlusContracts.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/subtaskCliExecution.test.js`：180/180；与定向组共 357 项相关 Node 测试通过，无跳过。
- 补充协议纠错用例改为通过 independentSubtaskIds 恢复独立派发，重新构建后 `node --test dist/test/extensionHost/loopPlusOrchestration.test.js`：118/118。
- 首轮定向测试 175/177，两个失败均为旧提示文案断言过期（示例不代表角色配额、不可修即全局 blocked），已更新为新策略并重跑通过；没有实现失败或范围外失败被忽略。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：2 domains / 17 concepts / 16 relations / 139 rules / 2 workflows 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9。
- `git diff --check`：通过。功能清单、调度设计、会话复用设计、暂停排查 runbook 与三条既有 ontology 规则同步；无新增业务实体或持久化迁移。
- 真实模型派发质量、安装后的 VS Code 和 Windows 实机未验证；本次不涉及 UI，无浏览器验证需求。测试使用真实宿主编排和 scheduler、隔离的子任务执行适配器，不访问用户配置或真实 CLI 会话。
- 记忆维护判断：稳定原因与处理规则已进入对应设计、runbook 和 ontology，不重复写入记忆热区；未写入 ROLLING_SUMMARY.md。

## 当前结论

当前工作区 npm run build 通过，10 个变更文件与隔离验证版本逐字节一致；修复、相关回归与事实来源同步已完成。源码、测试及文档随本计划一并提交，远端交付结果以 Git 记录为准。未发布扩展。
