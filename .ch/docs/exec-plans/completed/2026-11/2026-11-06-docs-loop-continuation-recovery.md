# Loop / Loop+ 续跑恢复能力与排障文档

- 日期：2026-11-06
- 状态：completed
- 类型：docs
- 负责人：Codex

## 背景与目标

将恢复链路修复后的真实边界写入产品事实和排障手册：同档案续跑可复用，但有效租约、档案互斥和按钮回执约束不能被误解为已解除。

## 关联计划

- [恢复实现](2026-11-06-bugfix-loop-continuation-recovery.md#验收标准)：提供同档案复用及按钮收尾事实。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：提供真实进程和本机消息桥证据及失败边界，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-loop-continuation-recovery.md`；本计划不认领测试开发。

## 范围与非目标

- 范围：功能清单、能力规格、ontology、既有按钮状态避坑条目的实际文档同步。
- 非目标：修改生产代码、增加回归、修改配置格式或架构边界、追加热区流水；本轮仅分配历史文档交付，不再次编辑外部文档或 ontology。

## 验收标准

- [x] 清单与能力规格说明同档案就绪复用和租约互斥边界，不承诺运行时自由切换配置。
- [x] ontology 与既有按钮状态避坑条目同步已确认事实，runbook 保留按钮临时状态经验。
- [x] 明确架构和用户配置格式未变、无需改架构；稳定经验并入 runbook，不重复写入热区或 `ROLLING_SUMMARY.md`。

## 影响面与风险

仅产品、知识来源与排障文档；风险是把同档案复用描述成绕过有效租约，或把未安装的新构建描述成已生效。按关联实现与原始未发布边界核对，必要时只撤销错误文字。

## 验证计划

历史核对功能清单、能力规格、ontology 与排障条目的事实一致性，执行 ontology validate、对应单测和差异空白检查；不重跑业务或真实 CLI。本轮只验证拆分文档局部结构/链接。

## 测试与清单同步

- 功能清单、能力规格、ontology、既有按钮状态避坑条目已同步。架构边界和用户配置格式未变，无需修改架构文档；稳定经验已并入 runbook，不重复写入热区或 `ROLLING_SUMMARY.md`。
- 历史文档校验：ontology `--validate` 通过；ontology skill 的 9 项单测通过；UI 检测器无发现；改动范围尾随空白检查和 `git diff --check` 通过。这里只保留执行证据，不另认领 ontology 测试开发。
- 运行时/浏览器失败与全量 3 项跳过按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-loop-continuation-recovery.md` 见测试计划移除审计；本计划不以文档完成推导真实 CLI、Windows/Linux 或宿主已验收。

## 任务列表

- [completed] 更新恢复能力清单与规格
- [completed] 同步 ontology 与按钮状态 runbook，确认架构/记忆无需重复写作
- [completed] 记录历史文档校验和未发布边界

## 当前结论

继承原 completed，文档写作与既有校验完成。未调用真实付费模型，未在 Extension Development Host 执行真实 CLI 全链路，未发布或安装扩展；源码构建需由更新后的扩展加载后才能修复既有安装中的行为。文档完成不代表所有环境已验证。
