# Loop+ 合理并行拆分与轻量冲突协作

- 日期：2026-11-06
- 状态：completed
- 负责人：Codex

## 背景与目标

用户反馈 Loop+ 通常只派发 1–2 个并行子任务，希望增加合理并行以缩短耗时，同时避免大量冲突，允许子任务自行处理极少量局部冲突。

当前生产调度并发上限与默认单次派发上限均为 6；调度器已支持越过受阻 pending 项回填。主模型提示却固定展示两个派发示例，并要求共享文件时保留单任务，没有展示实际剩余并发槽位。本次修正规划引导而非放宽调度保护。

## 范围与非目标

- 范围：主模型容量提示、按交付边界拆分、动态多任务协议示例、子任务局部冲突协作、回归测试和事实来源同步。
- 非目标：提高生产并发上限、放松明确 writeFiles / conflictGroup 重叠保护、增加协议字段、修改经典 Loop、界面改版或发布插件。

## 验收标准

- 主模型看见真实并发上限和剩余槽位；默认容量允许且存在至少三个独立交付边界时争取 3–6 路，不按前后端角色数限额，也不为凑数拆微任务。
- 仅有 1–2 个安全边界、真实前置依赖、配置限制或剩余槽位较少时，允许较低并行；已有 pending 不重复派发。
- 协议示例默认展示四个独立任务，并尊重单次派发与并发限制，包括单次上限为 1 的情况。
- 共享只读上下文和极少量附带修改不阻止独立主体并行；已知共享写入如实声明、集中所有权或局部串行，不隐藏冲突，不覆盖其他子任务改动。
- 构建和相关测试通过；宿主回归覆盖六路派发、冲突任务等待与空槽回填；同步功能清单、调度设计和 ontology。

## 影响面与风险

- 代码：`src/extensionHost/loopPlusPromptBuilders.ts`、`src/extensionHost/loopPlusOrchestration.ts`。
- 测试：主模型提示与宿主编排测试；复用现有 scheduler / parallel 单测。
- 文档：调度设计、功能清单、CLI 运行时 ontology。
- 风险：过度拆分、低估写入范围、示例超出用户限额。通过明确收益条件、真实冲突声明、独占共享契约和动态示例限额缓解。
- 回滚：撤销提示和容量传递改动，不涉及存量快照迁移或调度器数据结构变化。

## 验证计划

- 单元自测：`npm run build` 后执行 `node --test dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/loop/loopParallel.test.js`。
- 扩展验证：相关 Loop+ 运行时集成测试；ontology validate 和 ontology Python 单测；差异空白检查。
- 完整相关回归：`node --test dist/test/extensionHost/loopPlus*.test.js dist/test/loop/loopPlus*.test.js dist/test/loop/loopParallel.test.js`，276 项通过。
- 无 Webview 改动，不需要 Chromium；不调用真实外部 CLI 模型、不产生端到端模型任务费用。宿主夹具能验证准入与提示传递，不能证明真实模型未来每轮必定增加派发数量。

## 任务列表

Tasklist:
- [completed] 确认现有并发容量与低并行提示来源
- [completed] 调整容量感知规划与局部冲突协作提示
- [completed] 验证回归并同步文档与本体

## 决策记录

- 2026-11-06：使用 decision-model 比较“增强规划”“放松冲突保护”“提高上限”，返回增强规划，confidence=0.82；保持调度器硬保护，仅改善任务拆分和协作。

## 测试与清单同步

- 单元测试新增/更新：容量快照、split/fullstack 多任务指引、1/2/3/6/20 单次限额与宿主并发限额组合、无空槽和受阻 pending、只读角色不收到写入协作指令、六路准入与冲突项局部等待/回填；更新默认四任务示例断言。
- 单元自测结果：`npm run build` 通过；最小相关 134 项通过，额外运行时/协议集成 56 项通过，完整 Loop+ 相关回归 276 项通过；ontology validate 通过，ontology Python 单测 9 项通过；`git diff --check` 通过。
- 失败处理记录：首轮 134 项中 2 项失败。新增配置/文档示例缺少既有契约要求的显式 write scope 短语，属于实现缺陷，已补齐；新增单次上限为 1 的用例暴露 steer 示例固定两个 controls 的既有缺陷，已与派发示例一起按限额截断。重跑 134 项及扩大后的 276 项均通过。
- 功能清单、调度设计、ontology：已同步，新增容量感知并行业务规则并验证 source_refs。
- 热区记忆：本次稳定规则写入调度设计与 ontology；不向 ROLLING_SUMMARY 自动追加任务日志。

## 当前结论

已完成。生产并发上限保持 6，主模型按真实容量与独立交付边界争取 3–6 路，明确写入冲突继续串行，极少量附带冲突由子任务局部协调。已验证宿主六路运行、冲突项等待和独立任务回填，不以夹具验证替代真实模型调度效果保证。本次无 UI 和 CLI 适配变更，未运行 Chromium 或真实付费 CLI 端到端任务；后续实际规划效果需在加载新构建的 Loop+ 会话中观察。
