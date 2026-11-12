# Loop 子任务 Tab 自动关闭

- 日期：2026-07-24
- 状态：completed
- 负责人：Codex / 协作
- owner：Codex
- claimed_at：2026-07-24
- claim_ttl：1d
- handoff_to：
- 类型：feature

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [docs：产品、运行时或审计文档写作](./2026-07-24-docs-subtask-tab-auto-close.md)：同源历史任务；文档计划依据本实现的能力和兼容边界编写事实说明；写作不再属于本实现。

以上记录按原计划的实际交付拆分，日期、完成状态与各项验证限制沿用历史记录；下列历史命令及结果不是2026-11-11重新执行的证明。

## 背景

用户要求 Loop 模式子 tab 结束后自己关闭，不再根据已有配置判断；相关配置可以移除。

## 目标

- Loop 子任务 tab 在子任务正常结束后统一自动关闭，不再读取 `loopAutoCloseSubtaskTabs`。
- 移除或隐藏用户侧自动关闭配置入口，并同步运行时类型和状态。

## 范围

- Loop 子任务 lifecycle / extension wiring。
- 工具设置 / Webview状态 / i18n；独立测试更新不归本记录（原test计划已删除），事实规格写作仍归关联docs。

## 非目标

- 不改变主任务 tab 运行态锁定规则。
- 不改变 failed/blocked 节点状态语义；本次只处理子 tab 生命周期。

## 验收标准

- [x] Loop 子任务结束时不依赖配置，成功结束后自动关闭 tab。
- [x] `loopAutoCloseSubtaskTabs` 不再作为用户可配置项暴露。
- [x] 相关 build / 单元测试 / diff check 通过。

## 验证计划

- `npm run build`：通过。
- `node --test dist/test/loopSubtaskLifecycle.test.js dist/test/toolSettings.test.js dist/test/workspaceSettingsStore.test.js dist/test/sessionMessageActionsCoreCoverage.test.js dist/test/clipagescriptruntimecoverage.test.js dist/test/opencodethinkingintegration.test.js`：56/56 通过。
- `node --test dist/test/cliPageStaticRenderCoverage.test.js dist/test/opencodeloopmodewebview.test.js dist/test/sessionMessageActions.test.js`：32/32 通过。
- `git diff --check`：通过。
- `codegraph sync`：通过。

## 任务列表

- [x] 定位 Loop 子 tab 关闭链路和配置入口。
- [x] 修改 runtime 行为与配置状态。
- [x] 实现变更的历史验证证据留存删除审计（不接回测试开发）；事实来源写作由关联docs承担。
- [x] 验证并归档计划。

## 完成记录

- Loop 子任务 tab 成功结束后固定自动关闭，不再读取或暴露关闭开关；失败、停止或无目标 tab 时不关闭。
- 工具设置、PanelState、Webview DOM/state/i18n、settings message 处理、tool/workspace settings normalizer 中移除 `loopAutoCloseSubtaskTabs`。
- 文档完成事实由关联docs记录；历史已完成计划的旧口径不由本实现修改。

## 测试与清单同步

- 测试开发与原始验证/失败明细见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)，本实现记录仅消费验证证据。
- 产品/运行时/审计文档及功能清单写作见关联[docs计划](./2026-07-24-docs-subtask-tab-auto-close.md#范围与非目标)，不属于本实现范围。

## 影响面、风险与清单同步

影响Loop生命周期、工具设置和Webview状态；风险是误关失败/停止节点，缓解为仅成功结束关闭。测试与文档范围分别见上述互链，功能清单是否实际更新原文未单独列明，不补造。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
