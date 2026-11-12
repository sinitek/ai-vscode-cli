# Loop 子任务思考力度规格与角色规则同步

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- 类型：docs

## 背景与目标

将用户提交角色力度不再被 xhigh 上限截断的事实写入功能/能力规格、CLI 参考及既有 ontology 角色启动规则。

## 范围与非目标

- 已同步功能清单、详细能力规格、CLI 运行时参考及 ontology 角色启动规则。架构依赖边界不变，不另改 ARCHITECTURE.md；其中原有未提交改动保留。
- 不新增热区记忆或 EVENT_MEMORY：本次是已有规则的范围明确变更，事实源和本计划足以留痕。

- 不承担设置/执行链路或测试开发，不新增平台能力和默认策略。

## 验收标准

文档说明旧上限字段忽略、不改用户文件，以及 CLI 能力校验、角色隔离与默认行为不变；不误写为新增 CLI 支持或真实付费验收。

## 风险与缓解

架构边界未变，保留既有 ARCHITECTURE 并发修改；不新增热区记忆。

## 验证计划与历史结果

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。

原计划空白检查通过；历史测试结果摘要按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-loop-thinking-uncapped.md` 见[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，该审计不保留完整命令。本轮不重复九项脚本测试或 ontology 全域验证。

## 当前状态

产品清单、详细能力规格、CLI 参考与角色启动规则同步完成；原 completed 保留。

## 关联计划

- [feature：移除 Loop/Loop+ 子任务思考力度上限](2026-11-05-feature-loop-thinking-uncapped.md#背景与目标)：分别承接移除 Loop/Loop+ 子任务思考力度上限，共享本来源的历史背景与接口。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留 Loop 子任务力度保留与旧配置回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-loop-thinking-uncapped.md`；不再作为现行测试责任。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
