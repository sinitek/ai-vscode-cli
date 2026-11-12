# Loop 全 CLI 模型与思考力度路由修复

- 日期：2026-11-03
- 类型：bugfix
- 状态：blocked
- 负责人：Codex

## 关联计划

- 共同背景：原计划混合了已完成的七 CLI 路由实现、独立自动化回归和未通过的真实 Loop+ 验收/发布门禁。本文件仅跟踪路由实现；已移除测试计划所记录的回归开发及历史单测结果见[测试计划删除审计](../migrations/test-plan-removals/2026-11-11-nov-active.json)，`source_old_path` 为 `.ch/docs/exec-plans/active/2026-11-03-loop-routing-release-176.md`；真实验收、发布门禁和恢复依赖由存活的 [`2026-11-03-chore-loop-routing-live-acceptance-release.md`](2026-11-03-chore-loop-routing-live-acceptance-release.md) 跟进。
- 原实现、test、chore 三份记录均继承 `blocked` 状态；test 计划已移除，其原状态、责任和历史证据仅作为[删除审计](../migrations/test-plan-removals/2026-11-11-nov-active.json)记录（`source_old_path`：`.ch/docs/exec-plans/active/2026-11-03-loop-routing-release-176.md`）。此文件中的实现代码完成不代表自动化测试合同或真实验收通过。

## 背景与目标

承接同 CLI 子模型修复；用户要求 Loop / Loop+ 全 CLI 模型、思考力度正确路由，并用 gpt-6.1-sol 主模型与 gpt-6.1-terra 子模型真实执行 Loop+，成功后发布 1.7.6，提交并推送。

## 范围与非目标

覆盖七种 CLI 的共用路由与最终参数适配。不调整用户配置或真实业务任务，不修复无关历史测试。

保留原始目标与历史证据供追溯；真实模型验收、发布门禁及恢复步骤由关联 chore 计划单独跟进，迁移本身不执行这些历史命令。

历史发布指令仅保留为迁移前记录；当前根级 `AGENTS.md` 禁止执行 `scripts/publish_vscode_extension.py`，本计划及关联计划均不得运行该脚本。

## 验收标准

- Loop / Loop+ 同 CLI、跨 CLI、新会话及续接保留各角色模型和思考力度；不支持的能力按 CLI 契约处理。
- 共用路由实现符合七种 CLI 的参数适配约定；原自动化回归开发及其历史结果见上述历史证据审计项，本计划不认领测试开发。
- 未完成的真实验收门禁及任何后续发布授权评估仅由关联 chore 计划承接；此 bugfix 不以验收真实调用或发布作为自身交付标准。

## 风险与缓解

- 真实调用有费用与写盘风险，恢复验收前应遵从关联 chore 计划与当时有效规则；本计划不发起调用。
- 实现风险按本计划跟进；自动化测试的历史风险及证据见上述审计项，当前仍存活的真实调用风险由 chore 计划以路径指针去敏记录，不提交凭据、用户 prompt 或运行配置。

## 验证计划

- 本计划记录实现验证；历史测试开发、结果及边界见[测试计划删除审计](../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/active/2026-11-03-loop-routing-release-176.md`），不存在存活测试计划。真实模型验收及恢复门禁见关联 chore 计划。

## 当前结论

路由修复代码实施完成；原任务整体仍 **blocked**，真实验收没有成功收口。用户选择保留门禁；未发布。发布命令仅作为历史记录，当前根规则禁止执行。

## 实施与验证记录

- 共用编排修复沿用上一计划；补齐 Grok / DSH / Kimi Code / ZCode 的发送快照，ZCode 的宿主角色模型与思考档解析。
- OpenCode 子任务在水合时保留已绑定执行模型；显式角色思考档传到实际 variant，未指定时不覆盖原角色 variant。归一化保留 OpenCode 高档与 DSH medium。补齐 OpenCode / Claude 主布局的全栈、前端思考事件。
- 自动化测试、构建、UI smoke 与其失败分类的原始证据原由 test 计划记录，现以[测试计划删除审计](../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/active/2026-11-03-loop-routing-release-176.md`）追溯；此处仅引用历史事实，不重新认领测试交付。

## 真实验收依赖

真实 terra 调用、429 失败、用户保留门禁的决定、未发布事实、原始证据路径及恢复步骤均由关联 chore 计划单独记录；当前根级 `AGENTS.md` 禁止执行发布脚本。此拆分不会改变任何历史验收结论。
