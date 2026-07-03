# 文档系统总览

这个目录不是“补充阅读材料”，而是仓库内的知识系统。

对 Codex 和人类来说，这里都应该是最可靠、最可追踪的事实来源之一。

## 快速入口

- `.ch/docs/DESIGN.md`：设计文档如何写、何时写。
- `.ch/docs/FRONTEND.md`：前端与体验层约束。
- `.ch/docs/PLANS.md`：执行计划与任务收尾方式。
- `.ch/docs/PRODUCT_SENSE.md`：ToB 产品思维与验收视角。
- `.ch/docs/TESTING.md`：单元测试与验证基线。
- `.ch/docs/FEATURE_CHECKLISTS.md`：功能清单的事实来源与更新规则。
- `.ch/docs/QUALITY_SCORE.md`：当前骨架质量评分。
- `.ch/docs/RELIABILITY.md`：可靠性与验证基线。
- `.ch/docs/SECURITY.md`：安全基线。
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`：当前 VS Code 插件实际运行时架构。
- `.ch/docs/references/cli-runtime-reference.md`：CLI 接入事实参考。
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`：当前插件能力规格。
- `.ch/docs/runbooks/local-development.md`：本地开发、调试与打包手册。
- `.ch/docs/references/authoritative-skills.md`：权威外部技能清单与更新来源。
- `.ch/docs/runbooks/PITFALLS.md`：已经踩过的坑、复发条件与规避方式。

## 目录结构

- `.ch/docs/design-docs/`：设计历史、核心信念、设计模板。
- `.ch/docs/exec-plans/`：活动中的执行计划、已完成归档、技术债跟踪。
- `.ch/docs/generated/`：可由工具生成的清单、索引、schema 文档。
- `.ch/docs/product-specs/`：业务规格、用例、范围和验收文档。
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`：功能总表与当前状态入口。
- `.ch/docs/references/`：官方规范对齐、外部参考、AI 友好参考资料。
- `.ch/docs/runbooks/`：运行、发布、排障、值班和环境操作手册。

## 维护原则

- 文档是系统的一部分，不是任务结束后的附属品。
- 一旦发现真实踩坑，要及时沉淀为避坑指南，而不是留在聊天记录里。
- 索引优先于大段正文。
- 每个目录至少保留一个清晰入口页。
- 测试基线和功能清单都应有清晰事实来源，不依赖聊天记忆。
- 新增主题前，优先判断是否应该放入已有主题目录，而不是横向再造新目录。
