# 设计文档索引

设计文档用于记录“为什么这样做”，而不只是记录“将要写哪些代码”。本页是设计文档规则的单一入口；文档总入口统一收口到 `.ch/docs/README.md`。

## 当前文档

- `.ch/docs/design-docs/core-beliefs.md`：这个骨架的核心信念与长期约束
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`：VS Code CLI 插件运行时架构、分层边界和事实来源
- `.ch/docs/design-docs/loop-debate-multi-agent-mode.md`：Loop 红蓝辩论多智能体模式设计
- `.ch/docs/design-docs/graph-orchestration-mode.md`：Graph 编排模式设计和当前能力边界
- `.ch/docs/design-docs/TEMPLATE.md`：新设计文档模板

## 什么时候需要设计文档

- 新增核心业务域。
- 引入新的服务边界、部署单元或数据流。
- 做迁移、重构、治理、平台级改造。
- 更改权限模型、审计模型、集成模式、同步/异步边界。

## 新增设计文档要求

- 在本页补索引
- 标明状态：proposed / accepted / superseded
- 标明相关目录、相关计划、相关规格文档
- 不要把任务拆分过程直接写成设计文档
- 如果某条结论只在当前任务内有效，先留在计划或热区，不要过早膨胀成设计文档

## 最少要回答的问题

- 问题是什么
- 为什么现在要做
- 约束是什么
- 备选方案有哪些
- 最终选择了什么
- 代价和后续影响是什么
