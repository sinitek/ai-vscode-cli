# 总监同批派单的写入冲突

- 日期：2026-11-28
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-28-perf-department-parallel-acceptance.md` 规定各组交付和验收的归属。

## 原因与修复

旧宿主核对新模块与活动模块的写入冲突，却漏掉同一批新模块之间的重叠。回归在修改前复现了 `shared` 和 `duplicate` 同时启动，两组分别声明修改 `src/shared` 和其中的文件。

宿主现在在登记本批第一位组长前，通过已有路径和互斥资源判定检查 `writeFiles` 和 `conflictGroup`。有重叠时将模块 ID 及冲突项返回总监，由总监立即重排一次。重排仍冲突时，有活动组就让其继续执行并汇报，无活动组则将原因记入根任务并转为待审。总监的协调上下文包含已派模块的写入范围。业务上相同的验收项由总监在派单时确定唯一归属。

## 验收结果

`node --test dist/test/extensionHost/departmentproductioncomposition.test.js` 覆盖目录与子文件重叠、互斥资源名大小写、重复冲突待审，以及已有组继续执行并唤醒总监。旧例修正后只启动 `shared` 和 `reports`，原冲突批次登记的组长数为零。

`npm run build` 与 ontology 校验通过，部门设计、功能清单和 ontology 已同步。相关 106 项回归及扩大范围后与基线一致的 17 项失败，见关联的并行验收计划。
