# generated 目录说明

这里放**可由工具稳定生成**的文档产物，不放人工长期维护的规则文档。

当前已支持的生成物包括：

- 仓库结构与命令导航索引（`repo-indexer` 生成）
- 热区记忆与开放事项索引（`memory-indexer` 生成）
- 围绕当前 focus 的受控召回包（`memory-recall` 生成）
- 记忆上提候选与 coverage gap 报告（`memory-consolidator` 生成）
- 任务工作台 Markdown / JSON（`task-board` 生成）
- 多计划下一步、阻塞与占用关系视图（`work-frontier` 生成）
- claim / release 缺口与过期占用报告（`claim-release-auditor` 生成）
- 可跨仓复制的稳定骨架导出包（`reference-pack` 生成）
- reference pack 导入前差异检查报告（`reference-pack-importer` 生成）
- reference pack 导入后本地漂移审计报告（`reference-pack-drift-auditor` 生成）

未来还可以继续扩展：

- 数据库 schema 总览
- API/事件契约索引
- 路由地图
- 权限点清单
- 配置项清单

原则：

- 生成物要么可重建，要么有明确生成方式。
- 生成物用于提升代理和人类的可见性，不替代手写架构/规则文档。
