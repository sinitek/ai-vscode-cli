# 模型导入 Facade 与平台扩展架构说明

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- owner：Codex fullstack 子模型
- claimed_at：2026-11-05
- claim_ttl：本次执行内有效
- handoff_to：主审查者
- 类型：docs

## 背景与目标

实际同步 ARCHITECTURE 的 Facade/策略/发现/共享边界与新增平台流程，并纠正主审指出的两处白名单说明遗漏。

## 范围与非目标

- `ARCHITECTURE.md` 服务层边界、依赖方向与平台扩展方式。
- 补充策略表键派生平台白名单、modelimportshared.ts Claude五字段来源及对应回归文件。
- 不承担生产重构/测试开发；产品行为、协议、错误文案、草稿与安全限制不变，无需改 FEATURE_INVENTORY；ontology Facade 来源仍有效，不造新概念。

## 验收标准

准确区分兼容Facade通用校验、平台providers/writeDraft/discoveryFields、网络协议discovery与shared/types/edits边界；新增平台需同步两处白名单来源，不能重复定义。

## 风险与缓解

不把内部策略重排写成用户新功能、性能提升或协议变化；第一次遗漏必须保留并有补记，不称首次交付无遗漏。

## 主审发现与实际修复

2. **架构说明遗漏**：`ARCHITECTURE.md` 补充了平台扩展流程中必须同步更新的两处白名单来源（策略表键派生的平台白名单、`modelimportshared.ts` 的 Claude 五字段），并指出对应回归文件。

本项与 [范例导入原计划的早期同步记录](2026-11-05-feature-example-import-model-discovery.md#功能清单与文档边界)关联，共享同日架构补正而非新增第二套范例文档范围。

## 验证计划与历史结果

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：`validation passed: domains=2 concepts=16 relations=15 rules=105 workflows=2 documents=3`。
- `git diff --check -- src/config/modelimport.ts ARCHITECTURE.md .ch/docs/exec-plans/active`：退出码 0；本次新增/修改的 9 个文件用 Python 空白扫描 0 命中。
- `npm run validate:whitespace`：退出码 1，唯一命中为修改前已存在的 `AGENTS.md:8: trailing whitespace`（历史问题，未修改根规则文件，符合任务约束）。

## 当前状态

架构说明及第二轮平台白名单补记完成；历史全仓空白唯一AGENTS:8问题仍未改，本轮未执行历史命令。完整owner/claim/handoff随原文保留。

## 关联计划

- [refactor：模型导入平台策略注册表重构](2026-11-05-refactor-model-import-platform-strategies.md#背景与目标)：分别承接模型导入平台策略注册表重构，共享本来源的历史背景与接口。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留模型导入七平台策略与架构边界测试历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-model-import-platform-strategies.md`；不再作为现行测试责任。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
