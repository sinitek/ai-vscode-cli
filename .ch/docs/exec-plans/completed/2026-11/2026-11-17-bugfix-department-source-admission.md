# 部门新任务来源独占冲突修复

- 日期：2026-11-17
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

本机 `department-tasks-v1` 只有 source/owner 标记，没有任务文件。所有窗口共享此根，另一窗口占用或旧宿主遗留标记使新任务永久报“部门受控任务来源无法取得独占所有权或尚需恢复”。修复新建准入，同时保留旧来源及全局身份保护。

## 范围与非目标

保留明确根路径的独占合同；宿主装配仅在独占 claim 冲突时创建全新独立根。在共享 writer gate 下仅允许追加空来源，不替换既有 catalog、ID、墓碑或普通迁移记录。只在 catalog 结构有效且全部登记根都已消失时，受限修复 ready=false 的未发布目录，并保留墓碑；不恢复或重放旧任务。不盗取标记，不按 PID/时间清锁，不变更 CLI、容量和执行清理合同。保留工作区已有未提交修改，在其上做有界修复。

## 验收标准

- 原来源有活跃或遗留 owner 时，新宿主可创建、持久读取和更新自己的完整部门任务。
- 原来源标记、任务、身份及删除墓碑不变，跨来源重复 ID 和普通 writer 提升继续拒绝。
- 非空/重叠新来源、未知锁、损坏 catalog、仍存在登记根的未发布 catalog、未完成事务或原来源重建失败继续拒绝；仅结构有效且所有登记根已消失时允许恢复目录结构并保留身份墓碑，不能借新来源恢复任务数据。
- 构建及最小相关回归通过，完成隔离真实 Node 宿主验证。

## 影响面与风险缓解

涉及生产来源工厂、身份目录、extension 装配、对应回归和存储事实文档。最大风险是追加来源误提升普通文件或覆盖目录，限定全新空根、非重叠且无任何既有贡献，并在原共享锁内原子追加。旧来源 cold recovery 保持原有拒绝边界；独立根的历史保留及回收不在本次范围。回滚仅撤销本次代码补丁，不删除运行数据。

## 验证计划

- `npm run build`
- `node --test dist/test/extensionHost/departmentHostTaskStore.test.js dist/test/extensionHost/departmentProductionTaskStore.test.js dist/test/loop/loopTaskIdentityCatalog.test.js dist/test/extensionHost/departmentOwnedTaskSource.test.js dist/test/extensionHost/departmentOwnedSourceController.test.js dist/test/extensionHost/departmentOwnedTaskRepository.test.js`
- 视影响补充 session/生产接线回归；隔离 HOME/USERPROFILE 的真实子进程验证遗留 owner 和不同宿主，不调用付费模型。
- ontology 校验及单测；本次文件 whitespace 检查。

## 测试与清单同步

- 新增：占用/冷退出后新建、双来源身份保护、空来源追加和不确定状态拒绝。
- 结果：`npm run build` 通过；6 个定向 Node 测试文件 64/64 通过，包括隔离 HOME/USERPROFILE 的真实子进程旧 owner 存活/退出验证；ontology `--validate` 与 9 项单测通过；`git diff --check` 通过。
- 失败分类：额外合并执行的 production wiring/composition 回归有 11 项失败、1 项在手动中断时取消，主要为既有 employee-builder/director-delivery 等待超时。单独重跑 `production composition uses one producer for two native mains and codex employee admission` 仍在 12 秒等待窗口后报 `production-wiring-fixture-timeout`；该 fixture 显式调用 `createDepartmentProductionTaskStore(file("owned"))`，不经过本次新增的 host 来源选择入口，且失败点是等待员工 builder，未确认基线，故作为未归因的范围外回归限制记录，不宣称宽范围组合通过。`npm run validate:whitespace` 被未修改的 `AGENTS.md:8` 尾随空格拦截。
- 同步：FEATURE_INVENTORY、department-owned-task-repository、ontology 与 PITFALLS 已更新；计划按日期归档。
- UI 未改，无需 Chromium；真实安装版 VS Code / CLI 未覆盖。

## 当前进展

已完成来源冲突修复、64 项定向回归、构建和文档同步。验收限定为来源 admission 与存储合同；真实 VS Code Extension Host/CLI、冷启动及 Windows/Linux 未覆盖。额外 production wiring/composition 测试失败及 whitespace 检查受未修改 AGENTS.md 尾随空格阻挡的证据已如实记录。
