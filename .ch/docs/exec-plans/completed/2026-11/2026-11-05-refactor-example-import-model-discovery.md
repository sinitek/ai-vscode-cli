# 范例导入五字段与平台白名单单一来源

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- owner：example-import-model-discovery
- claimed_at：2026-11-05
- claim_ttl：本轮修复验证结束
- handoff_to：无；需真实远端或图形界面验收时另行执行
- 类型：refactor

## 背景与目标

主审指出上一轮 Facade 重复定义 Claude 五字段白名单。只消除同构定义，保持既有模型导入行为与接口。

## 范围与非目标

- `src/config/modelimport.ts`、`src/config/modelimportshared.ts`：Facade 与策略共用 `CLAUDE_FIELD_KEYS`，平台白名单由策略表键推导。
- 不承担范例弹窗新发现流程、异步状态修复或回归开发；相应实现范围见关联 feature 计划，已完成回归开发的历史证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-example-import-model-discovery.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。
- 原文早期记录同步 `ARCHITECTURE.md` 平台扩展说明并向上一轮计划补记，实际平台架构文档统一见 [model-import-platform-strategies docs](2026-11-05-docs-model-import-platform-strategies.md#背景与目标)，不重复建立范例导入 docs 交付。

## 验收标准

- [x] Facade 与策略共用同一五字段白名单，平台白名单由策略表键推导。
- [x] 保持旧平台/宿主 API 契约，无第二套供应商/协议映射。

## 风险与缓解

常量或平台集合漂移由历史三条单一来源回归覆盖；证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-example-import-model-discovery.md` 见测试计划移除审计，不改七平台配置生成器、真实配置或付费请求。

## 验证计划与历史结果

历史 `modelimport` 28/28、`modelimportplatformstrategies` 12/12、`modelimportui` 28/28 及构建验证结果摘要，按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-example-import-model-discovery.md` 见测试计划移除审计；该条目保留七项定向套件的准确命令及各自结果，合计125项。此处仍聚焦 refactor 所关注的三套件；全量结果明细不在审计条目内。无单独性能基准或外部行为改变声明。

## 当前状态

单一来源缺口已修复并有回归保护；原 completed 保留。功能清单/ontology 不因行为保持修复再增规则。

## 关联计划

- [feature：范例一键导入模型发现下拉](2026-11-05-feature-example-import-model-discovery.md#背景与目标)：分别承接范例一键导入模型发现下拉，共享本来源的历史背景与接口。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留范例模型发现阶段与异步身份回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-example-import-model-discovery.md`；不再作为现行测试责任。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
