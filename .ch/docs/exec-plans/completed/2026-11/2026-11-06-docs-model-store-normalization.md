# 模型存储规范化重构事实来源更新

- 日期：2026-11-06
- 类型：docs
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-06-refactor-model-store-normalization.md`（提供纯模块、类型与 Facade 的真实职责依赖）；[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-model-store-normalization.md` 单独记录13个新增特征用例与运行证据。
- 状态：completed
- 负责人：Codex
- owner：Loop+ round-1-refactor-model-store-normalization

## 背景与目标

将纯规范化模块与现有模型存储 Facade 的职责/依赖方向同步到架构事实来源，并在 ontology 中更新受实现事实来源拆分影响的 source references，不修改用户业务规则。

## 范围与非目标

- 范围：`ARCHITECTURE.md` 中职责和依赖方向；ontology 既有 DSH 思考、跨 CLI 子路由和 Loop+ 角色路由三条规则的 source_refs。
- 非目标：不新增 ontology 概念或业务规则，不更新功能清单（用户可见能力/验收不变），不承担测试开发。

## 验收标准

- [x] ARCHITECTURE 记录新纯模块/类型及旧 Facade 的职责边界。
- [x] 仅调整既有 ontology 规则的 source_refs，不改变规则语义。
- [x] 明确此变更源于实现事实来源拆分，并保持外部行为不变。

## 实际结果与验证

- ARCHITECTURE 已记录职责和依赖方向。
- ontology 起始状态为 ready；在上述三条既有规则补充纯模块/类型 source_refs，没有新增概念或修改业务规则。此项为实际文档写作与本体来源链接更新，不归作实现计划的附带验收。
- 主计划记录 ontology validate 通过、ontology 脚本单测9/9及 `git diff --check` 通过；本轮不重跑这些历史检查，也不主张全仓文档门禁已通过。

## 当前结论

架构和 ontology 来源导航已同步，独立文档交付完成。用户行为与业务规则未变；功能清单无需更新。测试范围及3项 DSH 跳过证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-model-store-normalization.md` 见测试计划移除审计，不存在存活 test 计划。
