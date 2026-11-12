# 最终答复 Markdown 渲染契约文档

- 日期：2026-11-01
- 状态：completed
- 类型：docs
- 负责人：Codex

## 关联计划

- 共同背景和运行时修复见 [`2026-11-01-bugfix-final-markdown-idle-frame.md`](2026-11-01-bugfix-final-markdown-idle-frame.md)。本计划只承接 `.ch/docs/references/cli-runtime-reference.md` 的契约说明。
- 回归用例开发及验证边界见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-01-final-markdown-idle-frame.md`）。

## 目标与范围

记录 Codex 最终答复与渲染契约说明的文档交付，帮助后续维护者区分最终答复收口和 Markdown 渲染时序。本计划不承接产品代码或回归测试开发。

## 验收标准

- `.ch/docs/references/cli-runtime-reference.md` 保留已完成的 Codex 最终答复和渲染契约说明。
- 说明与实现、回归计划互链，不夸大真实 Chromium 与测试覆盖范围。

## 验证与真实结果

- 原计划记录已同步 `.ch/docs/references/cli-runtime-reference.md` 中 Codex 最终答复和渲染契约说明；功能清单与 ontology 的既有变更明确属于其他任务。
- 本次迁移未重新检查外部文档差异，也未重跑历史业务验证。

## 当前结论

历史运行时参考文档交付已完成，状态 `completed`；代码修复和测试证据见关联计划。

## 验证计划

本轮仅核对本记录与关联来源的历史证据、职责分配及具体链接；原业务命令与执行结果以本记录和关联计划的历史记录为准，不重跑测试、构建、浏览器或真实CLI。
