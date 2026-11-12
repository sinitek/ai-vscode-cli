# Claude 原生上下文压缩切换——文档同步

- 日期：2026-05-21
- 状态：completed
- 负责人：Codex
- 类型：docs
- 迁移来源：`.ch/docs/exec-plans/completed/2026-05/2026-05-21-claude-native-context-compaction.md`

## 关联计划

- [feature：Claude 原生上下文压缩切换](2026-05-21-feature-claude-native-context-compaction.md)
- 历史测试证据：[删除审计](../../migrations/test-plan-removals/2026-11-11-apr-jun.json)（entries[1]；test 类型计划已删除，独立测试开发不并入本计划交付范围）。

## 迁移说明

2026-11-11 按实际工作类型拆分。日期、负责人及状态沿用原文；下列命令和结果均为历史记录，本次迁移不执行历史命令，也不新增验收结论。

## 独立目标与实施范围

同步Claude原生/compact、事件判定与旧环境明确不支持时的回退的事实来源、清单及相关说明；不承接运行时代码或测试开发。

## 独立验收与证据边界

文档反映原计划日期时的承诺、决策与验证边界；下方保留原有勾选与“需要/已同步”措辞，不把计划要求擅自提升为逐页验收通过。

实际结果以本文件下方分配的原始记录为准；未单独记录的结果仍未验证。整组构建/测试的历史证据见关联实现计划，不自动当作本工作包的独立验收。

## 范围

- 同步事实来源文档。

## 验收标准

- [x] 相关事实来源文档已同步。

## 影响面

- 文档目录：`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`

## 测试与清单同步

- 功能清单：本轮不新增功能项，仅更新运行时事实来源说明。
- 相关文档同步：补充 Claude 原生 `/compact` 行为与兼容回退说明。

## 任务列表

- [x] 同步事实来源文档并归档计划
