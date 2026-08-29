# generated 目录说明

这里放**可由工具稳定生成**的文档产物，不放人工长期维护的规则文档。

默认 core 生成物包括：

- 仓库结构与命令导航索引（`repo-indexer` 生成）
- 热区记忆与开放事项索引（`memory-indexer` 生成）
- 围绕当前 focus 的本地受控召回包（`memory-recall` 生成，默认写入 ignored 的 `.local/`）
- 记忆上提候选与 coverage gap 报告（`memory-consolidator` 生成）

未来还可以继续扩展：

- 数据库 schema 总览
- API/事件契约索引
- 路由地图
- 权限点清单
- 配置项清单

原则：

- 生成物要么可重建，要么有明确生成方式。
- 生成物用于提升代理和人类的可见性，不替代手写架构/规则文档。
