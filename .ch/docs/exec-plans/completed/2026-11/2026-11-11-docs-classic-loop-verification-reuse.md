# 经典 Loop 验证复用规则文档同步

- 日期：2026-11-11
- 类型：docs
- 状态：completed
- 负责人：Codex

## 关联计划

- 共同行为背景：[`2026-11-11-feature-classic-loop-verification-reuse.md`](2026-11-11-feature-classic-loop-verification-reuse.md)。
- 断言和回归证据：.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json。本计划独立承接文档事实源和 ontology 维护，不承接功能实现或测试开发。

## 目标与范围

同步经典 Loop 汇报驱动验证复用规则至架构、能力分册、功能清单、沟通模板事实来源及 ontology，保持历史沟通文件不改写，并明确 Loop+ 与独立验收边界。

## 验收标准

- 稳定规则在所需文档事实源和 ontology 中一致记录，不将历史模板默认要求升格为用户独立验收要求。
- 文档不改变运行时行为、不引入新的门禁，并可由关联存活 feature 计划追溯功能上下文；独立测试工作的审计保留摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-classic-loop-verification-reuse.md）。

## 验证与真实结果

- 迁移前记录：ontology 结构校验通过，ontology Python 单测 9 项通过；对代码、测试、文档、ontology 与计划的尾随空白检查及 `git diff --check` 通过。
- 这些是原交付记录的文档验证证据，不是本轮重新执行的结果；本轮未改 ontology 或文档事实源。

## 当前结论

规则文档与事实源同步已完成，状态 `completed`。本次只把原先混在 feature 记录内的独立文档交付拆成可追溯计划，不重写或重新声称其历史验证。

## 原始文档校验与同步详情（历史证据分配）

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 的 9 项测试通过。
- 对本次修改的代码、测试、文档、ontology 与计划运行 `node scripts/check_trailing_whitespace.js <文件列表>`，无发现；`git diff --check` 通过。
- 更新架构、能力分册、功能清单及 ontology 中相关概念/规则，并增加沟通模板与回归测试事实来源。无需修改运行时设计入口、memory 热区或事件记忆；稳定结论已在事实来源维护。
