# 恢复重试链路缺失的辅助函数

- 日期：2026-04-22
- 状态：validated
- 负责人：Codex
- 类型：bugfix
- 迁移来源：`.ch/docs/exec-plans/completed/2026-04/2026-04-22-all-cli-hidden-retry.md`

## 关联计划

- [feature：全 CLI 非主动中断隐式重试](2026-04-22-feature-all-cli-hidden-retry.md)
- [docs：全 CLI 非主动中断隐式重试——文档同步](2026-04-22-docs-all-cli-hidden-retry-documentation.md)

## 迁移说明

2026-11-11 按实际工作类型拆分。日期、负责人及状态沿用原文；下列命令和结果均为历史记录，本次迁移不执行历史命令，也不新增验收结论。

## 独立目标与实施范围

恢复 extension.ts 缺失的 trace / compaction / interactive helper，使既有代码重新可编译。

## 独立验收与证据边界

缺失 helper 已恢复；原文的整组 npm run build 通过是编译证据，不声称有独立回归测试。

实际结果以本文件下方分配的原始记录为准；未单独记录的结果仍未验证。整组构建/测试的历史证据见关联实现计划，不自动当作本工作包的独立验收。

## 当前结论

- 已恢复 `src/extension.ts` 中缺失的 trace / compaction / interactive helper，重新建立可编译结构。

## 历史验证证据

以下摘自原计划已记录的整组验证，只支持其原有覆盖范围；不是本次重新执行，也不是独立 UI 或真实运行验收。

- 已完成最小验证：`npm run build` 通过。
