# Loop+ 阻塞复核与分层提示文档规则

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：docs

## 背景与目标

将有限剩余工作复核、可恢复暂停及分层完成提示沉淀到产品事实、调度设计、排障指南与 ontology。

## 范围与非目标

- 产品规格、功能清单、调度设计、排障指南与两条 ontology 规则同步；不承担编排实现/测试开发。
- 根级架构边界不变，无需扩写 `ARCHITECTURE.md`；专题 runbook 已记录经验，不重复写热区记忆。

## 验收标准

文档说明每个无进展阶段仅一次复核、真实外部阻塞与授权门禁不放宽、调用/子任务/父任务完成不同层级；规则保留可核对源码与测试来源。

## 风险与缓解

不能将安全复核写成自动越过业务门禁；不对真实任务做回放/恢复声明。

## 验证计划与历史记录

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（105 条规则）；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- `git diff --check` 与本次文档的 `npm run validate:whitespace -- --files ...`：通过；专题 runbook 本地 Markdown 链接另做存在性核对。

## 文档与记忆收口

- 用户可见行为已同步 `FEATURE_INVENTORY.md` 与能力规格；调度设计和排障指南承载稳定规则。
- Ontology 新增有界复核与分层完成提示规则，保留可核对源码与测试引用。
- 本次经验已进入专题 runbook，不重复写 `ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md`。
- 已按计划日期归档到 `completed/2026-11/2026-11-05-loopplus-block-review.md`，主工作区为最终交付和验证事实来源。

上述原归档路径是历史记录，不作为待恢复旧文件；本轮最终路径由叶分片追溯。

## 当前状态

产品/设计/runbook及两规则交付完成；历史105条规则和9/9结果未在本轮重跑。

## 关联计划

- [feature：Loop+ 有限阻塞复核与分层完成提示](2026-11-05-feature-loopplus-block-review.md#背景与目标)：分别承接Loop+ 有限阻塞复核与分层完成提示，共享本来源的历史背景与接口。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留 Loop+ 阻塞复核与完成提示回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-loopplus-block-review.md`；不再作为现行测试责任。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
