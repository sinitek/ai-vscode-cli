# Codex Loop 角色模型与思考力度传递

- 日期：2026-07-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-29
- claim_ttl：本轮会话
- handoff_to：无
- 类型：feature

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [docs：产品、运行时或审计文档写作](./2026-07-29-docs-codex-loop-role-thinking.md)：同源历史任务；文档计划依据本实现的能力和兼容边界编写事实说明；写作不再属于本实现。

以上记录按原计划的实际交付拆分，日期、完成状态与各项验证限制沿用历史记录；下列历史命令及结果不是2026-11-11重新执行的证明。

## 背景

用户要求 Codex 任务能力与 OpenCode 任务保持一致：Loop 模式要支持主从模型，并分别配置、传递主模型与从模型的思考力度。

## 目标

让 Codex 在普通运行、Loop 主从任务中正确使用对应角色的模型与思考力度，避免子任务沿用主任务模型或主任务思考力度。

## 范围

- 检查现有 OpenCode 主从模型和思考力度链路。
- 补齐 Codex 对 Loop 角色模型和角色思考力度的选择、存储、运行时传参。
- 实现仅涵盖Codex角色选择、存储和传参；独立测试开发不归本记录（原test计划已删除），产品/设计文档仍归关联docs。

## 非目标

- 不替换 Codex/OpenCode/Claude CLI 技术栈。
- 不重构 Loop 调度核心。
- 不改变已有 OpenCode 模型配置语义。

## 验收标准

- [x] Codex Loop 主任务和子任务可分别选择模型，并在执行时传给 CLI。
- [x] Codex Loop 主任务和子任务可分别使用思考力度，子任务仍受全局子任务上限约束。
- [x] OpenCode 现有行为不回退。
- [x] 实现消费历史95/95及构建通过证据；测试开发与文档完成的独立验收见关联计划。

## 影响面

- 代码目录：`src/extension.ts`、`src/modelSelectionStore.ts`、`src/cli/`、`src/webview/`
- 文档影响及写作责任：见关联docs。
- 配置与脚本：无计划变更。

## 风险与缓解

- 风险：当前工作区已有未提交改动，目标文件可能包含用户修改。
- 缓解：修改前读取具体上下文，只做局部补丁，不回退无关改动。

## 验证计划

- 最小相关验证：针对模型选择、Loop runtime 的相关单测。
- 单元自测命令：`npm run build`；相关 `node --test dist/test/*.test.js`。
- 扩展验证：`git diff --check`、必要时 `codegraph sync`。

## 测试与清单同步

- 测试开发与原始验证/失败明细见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)，本实现记录仅消费验证证据。
- 产品/运行时/审计文档及功能清单写作见关联[docs计划](./2026-07-29-docs-codex-loop-role-thinking.md#范围与非目标)，不属于本实现范围。

## 任务列表

- [x] 使用 CodeGraph 定位模型与思考力度链路。
- [x] 补齐 Codex Loop 角色模型与思考力度运行时传递。
- [x] 角色接口的历史验证证据留存删除审计（不接回测试开发），采用历史验证结果确认实现边界。

## 决策记录

- 2026-07-29：保持 OpenCode 现有配置语义，优先复用现有 `selectedLoopByConfigId` / `loopRolesByConfigId` 角色模型结构扩展 Codex。
- 2026-07-29：Codex 角色思考力度按 active config + role + model 存储；普通 Coding 继续使用单模型思考力度，Loop 发送 `loopMainThinkingMode` / `loopSubtaskThinkingMode`，Loop 子任务运行时继续受全局 `loopSubtaskMaxThinkingMode` 上限约束。

## 当前结论

已完成 Codex Loop 主/子模型与主/子思考力度传递，覆盖 Webview 状态、消息 payload、模型存储、Loop 运行、手动子任务续跑唤醒。文档完成事实见关联docs；构建、相关测试和 diff whitespace 校验均通过；无未决问题。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
