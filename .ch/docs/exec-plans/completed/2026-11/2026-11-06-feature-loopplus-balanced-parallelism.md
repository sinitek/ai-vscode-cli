# Loop+ 合理并行拆分与轻量冲突协作

- 日期：2026-11-06
- 状态：completed
- 类型：feature
- 负责人：Codex

## 背景与目标

用户反馈 Loop+ 通常只派发 1–2 个并行子任务，希望增加合理并行以缩短耗时，同时避免大量冲突，允许子任务自行处理极少量局部冲突。

当前生产调度并发上限与默认单次派发上限均为 6；调度器已支持越过受阻 pending 项回填。主模型提示却固定展示两个派发示例，并要求共享文件时保留单任务，没有展示实际剩余并发槽位。本次修正规划引导而非放宽调度保护。

本计划仅交付容量感知规划和局部冲突协作能力，归 feature，不以修正提示措辞补造已发布版本 bug 背景。

## 关联计划

- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：仅保留最小与扩大两条历史验证命令，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-loopplus-balanced-parallelism.md`；依赖本计划的容量快照和动态协议示例，不再作为现行测试责任。
- 历史文档分工：依赖本计划确认的并行收益条件和硬冲突保护，承接功能清单、调度设计及 ontology 实际写作。三份计划分别继承原 completed，不扩大真实模型验收。 原 docs companion `2026-11-06-docs-loopplus-balanced-parallelism.md#验收标准` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 范围与非目标

- 范围：主模型容量提示、按交付边界拆分、动态多任务协议示例和子任务局部冲突协作的生产实现。
- 非目标：提高生产并发上限、放松明确 writeFiles / conflictGroup 重叠保护、增加协议字段、修改经典 Loop、界面改版或发布插件。
- 非目标：回归测试开发、功能清单/调度设计/ontology 写作；文档原由已退役 docs companion 独立交付（仅历史分工）。来源审计仅留存验证命令，不作为本计划实现任务或验收的测试结果证据。

## 验收标准

- 主模型看见真实并发上限和剩余槽位；默认容量允许且存在至少三个独立交付边界时争取 3–6 路，不按前后端角色数限额，也不为凑数拆微任务。
- 仅有 1–2 个安全边界、真实前置依赖、配置限制或剩余槽位较少时，允许较低并行；已有 pending 不重复派发。
- 协议示例默认展示四个独立任务，并尊重单次派发与并发限制，包括单次上限为 1 的情况。
- 共享只读上下文和极少量附带修改不阻止独立主体并行；已知共享写入如实声明、集中所有权或局部串行，不隐藏冲突，不覆盖其他子任务改动。
- 六路派发、冲突任务等待与空槽回填保持既有硬保护；构建和历史回归结果验证实现，不将测试开发或文档写作并入本计划验收。

## 影响面与风险

- 代码：`src/extensionHost/loopPlusPromptBuilders.ts`、`src/extensionHost/loopPlusOrchestration.ts`。
- 历史主模型提示与宿主编排回归开发的具体结果仍见原计划正文；上述来源审计仅保留最小与扩大验证命令。现有 scheduler / parallel 单测只作验证证据。
- 文档影响：调度设计、功能清单、CLI 运行时 ontology 的实际同步由 原 docs companion（已退役）曾承担。
- 风险：过度拆分、低估写入范围、示例超出用户限额。通过明确收益条件、真实冲突声明、独占共享契约和动态示例限额缓解。
- 回滚：撤销提示和容量传递改动，不涉及存量快照迁移或调度器数据结构变化。

## 验证计划

- 单元自测：`npm run build` 后执行 `node --test dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/loop/loopParallel.test.js`。
- 扩展验证：相关 Loop+ 运行时集成测试和差异空白检查；ontology validate 与 Python 单测的历史记录原由已退役 docs companion 承接（仅历史分工）。
- 完整相关回归：`node --test dist/test/extensionHost/loopPlus*.test.js dist/test/loop/loopPlus*.test.js dist/test/loop/loopParallel.test.js`，276 项通过。
- 无 Webview 改动，不需要 Chromium；不调用真实外部 CLI 模型、不产生端到端模型任务费用。宿主夹具能验证准入与提示传递，不能证明真实模型未来每轮必定增加派发数量。
- 上述为历史验证计划与结果；本轮仅拆分静态计划，不执行历史命令。

## 任务列表

Tasklist:
- [completed] 确认现有并发容量与低并行提示来源
- [completed] 调整容量感知规划与局部冲突协作提示
- [completed] 按配置上限动态生成派发和 steer 示例，保留硬冲突保护
- [completed] 用历史回归结果核对容量传递；来源审计仅留存验证命令，文档写作原由已退役 docs companion 独立交付（仅历史分工）

## 决策记录

- 2026-11-06：使用 decision-model 比较“增强规划”“放松冲突保护”“提高上限”，返回增强规划，confidence=0.82；保持调度器硬保护，仅改善任务拆分和协作。

## 测试与清单同步

- 原测试计划正文记录构建通过、134/56/276项结果，以及首轮134项中2项实现失败和修复；来源审计条目只保留最小与扩大验证命令，没有这些结果或失败摘要。此处沿用原计划历史记录，不把审计未收录内容表述为其留存证据，也仅复用验证结果。
- 原文记录的历史文档分工：功能清单、调度设计、ontology 历史同步与校验原归 `2026-11-06-docs-loopplus-balanced-parallelism.md#测试与清单同步`；不在本计划认领文档写作或热区日志。 该 companion 已退役；完整写作及校验记录无法由索引复核。[references 索引](../../../references/index.md)仅作导航。

## 当前结论

已完成。生产并发上限保持 6，主模型按真实容量与独立交付边界争取 3–6 路，明确写入冲突继续串行，极少量附带冲突由子任务局部协调。已验证宿主六路运行、冲突项等待和独立任务回填，不以夹具验证替代真实模型调度效果保证。本次无 UI 和 CLI 适配变更，未运行 Chromium 或真实付费 CLI 端到端任务；后续实际规划效果需在加载新构建的 Loop+ 会话中观察。
