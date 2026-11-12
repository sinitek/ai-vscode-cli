# Loop主从群聊面板复用——文档同步

- 日期：2026-06-17
- 状态：completed
- 负责人：Codex
- 类型：docs
- 迁移来源：`.ch/docs/exec-plans/completed/2026-06/2026-06-17-loop-main-sub-group-chat.md`

## 关联计划

- [feature：Loop主从群聊面板复用](2026-06-17-feature-loop-main-sub-group-chat.md)
- 历史测试证据：[删除审计](../../migrations/test-plan-removals/2026-11-11-apr-jun.json)（entries[2]；test 类型计划已删除，独立测试开发不并入本计划交付范围）。

## 迁移说明

2026-11-11 按实际工作类型拆分。日期、负责人及状态沿用原文；下列命令和结果均为历史记录，本次迁移不执行历史命令，也不新增验收结论。

## 独立目标与实施范围

同步主从group-chat.md、动态成员、入口和刷新行为的事实来源、清单及相关说明；不承接运行时代码或测试开发。

## 独立验收与证据边界

文档反映原计划日期时的承诺、决策与验证边界；下方保留原有勾选与“需要/已同步”措辞，不把计划要求擅自提升为逐页验收通过。

实际结果以本文件下方分配的原始记录为准；未单独记录的结果仍未验证。整组构建/测试的历史证据见关联实现计划，不自动当作本工作包的独立验收。

## 范围

- 更新事实来源文档。

## 影响面

- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/references/`

## 测试与清单同步

- 功能清单：更新 Loop 群聊条目。
- 相关文档同步：更新运行时设计和 CLI runtime reference。

## 任务列表

- [x] 同步文档
