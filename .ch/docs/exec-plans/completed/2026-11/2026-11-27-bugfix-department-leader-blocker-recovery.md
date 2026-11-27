# 产研部组长阻塞后的总监接力

- 日期：2026-11-27
- 类型：bugfix
- 状态：completed
- 负责人：Codex

## 背景与范围

组长结算会唤醒总监，但组长失败加缺少 `blocker` 的总监回复会暂停根任务。总监原先没有向原组长下发恢复步骤的指令。改动覆盖部门协调、同一组长的 Loop+ 续跑与原生会话核对。

## 实现与验收

- 总监根据真实报告安排恢复或独立工作。出现失败组长且无活动组长时，同一批失败代次有一次自动复核机会。
- 指令指定组长任务 ID、现有代次和恢复步骤。宿主验证清理、归属、会话及占用，持久化新代次，并保留原任务与验收方案。旧代次、未核验清理、显式中止、失败上限及待确认澄清均拒绝。
- 若组长记录仍用本地占位会话，复用已有绑定修复，从已结束的主回合、会话历史和标签页核对原生会话。

## 验证结果

- 当前工作区通过 `npm run build`。`node --test --test-timeout=30000 dist/test/extensionHost/{departmentruntimecomposition,departmentorchestration,departmentruntimeintegration,loopMainDecisionParsing,loopPlusRuntimeIntegration}.test.js` 共 262 项通过。覆盖解析、原组长续跑、占位会话修复、未清理和旧代次拒绝。
- 在隔离 macOS VS Code 和真实 Codex CLI 上运行 `node scripts/verify_department_full_eh_integration.js --scenario loop-plus --product <隔离构建> --report <报告路径>`。验证用本机确定性响应先触发第一个组长熔断，再由总监下发恢复步骤。原组长通过同一原生会话消费指令，从代次 1 续到代次 2，完成事件验收、总监汇报和容量归还。报告为 `.tmp/department-leader-recovery-eh-verified.json`，临时验证夹具差异为 `.tmp/department-leader-recovery-eh-fixture.patch`。线上模型和 Windows/Linux 实机留待对应环境验证。
- 扩大的普通 Loop+ 编排套件遇到既有挂起。干净基线中同一套件在 `--test-timeout=25000` 下有 199 项通过、4 项超时，记录于 `.tmp/department-leader-recovery-loopplus-baseline.log`。
- 已同步功能清单、设计和 ontology。`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与 `git diff --check` 均通过。
