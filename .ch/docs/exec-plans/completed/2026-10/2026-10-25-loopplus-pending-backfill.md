# Loop+ 待启动子任务并行回填

- 日期：2026-10-25
- 状态：in-progress
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-25
- claim_ttl：本次任务
- handoff_to：

## 背景

Loop+ 调度器会把因运行中任务冲突而等待的 pending 子任务加入冲突预留集合，导致后续本可与运行中任务并行的子任务也被队列中的任务阻塞。调度派发日志只记录 pending ID，无法直接区分冲突与并发上限。

## 目标

让调度器只按实际 running 任务和本轮已准入任务检查冲突；允许兼容运行中任务的后续子任务回填空闲并发槽，并记录每个待启动决策的阻塞原因。

## 范围

- 修正 `src/loopPlusScheduler.ts` 的 pending 准入和阻塞解释。
- 补 scheduler 与 orchestration 回归测试及 pending 诊断日志。
- 同步 Loop+ 调度设计、产品规格、功能清单和 Ontology。

## 非目标

- 不改变 `maxConcurrency`、3 秒错峰启动、冲突路径规范化或人工中断预留语义。
- 不修改经典 Loop / Graph 调度策略。
- 不重排或纳入当前主工作区已有的其他未提交变更。

## 验收标准

- [x] A 写 `x.ts` 运行、B 写 `x.ts` 和 `y.ts` 待启动时，C 写 `y.ts` 可与 A 并行启动。
- [x] 已运行任务的写入冲突仍阻止新任务；并发槽满时准确报告并发阻塞。
- [x] Loop+ 派发日志为 pending 项记录冲突或并发上限原因。
- [x] 构建、相关 scheduler / orchestration 单测和 Ontology 校验通过。
- [ ] 只提交本任务文件，并推送本次提交。

## 影响面

- 代码目录：`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`
- 测试目录：`src/test/loop/loopPlusScheduler.test.ts`、`src/test/extensionHost/loopPlusOrchestration.test.ts`
- 文档目录：`.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/product-specs/`
- 配置与脚本：无

## 风险与缓解

- 回填可能让较早 pending 子任务等待更久；保留 pending FIFO 顺序，并仅让当前 running 冲突或并发占满阻塞启动。
- 磁盘与 runner 启动仍由宿主错峰管理；不改变已准入任务的启动链和并发上限。
- 主工作区包含用户无关修改；在独立 detached worktree 实施，只带回本任务明确文件。

## 验证计划

- 最小相关验证：Loop+ scheduler 与 orchestration 编译及测试。
- 单元自测命令：`npm run build`；`node --test dist/test/loop/loopPlusScheduler.test.js dist/test/extensionHost/loopPlusOrchestration.test.js`
- 扩展验证：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`；检查补丁和 staged 文件名单；检查远端分支后推送。

## 测试与清单同步

- 单元测试新增/更新：覆盖冲突队列回填、running 冲突、并发阻塞解释、调度日志原因。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/loop/loopPlusScheduler.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js` 116/116 通过；`npm run validate:whitespace`、Ontology 校验和 Ontology unittest 9/9 通过。
- 失败处理记录：首轮集成断言使用了 scheduler 生成 attempt ID 的旧预期；按实际 `lp<seq>-<subtaskId>` 更新断言后，全部相关测试通过，属于测试夹具预期修正，不是实现缺陷。
- 功能清单：更新 Loop+ 调度条目及验证命令。
- 相关文档同步：更新产品规格、设计契约、Ontology。

## 任务列表

- [completed] 排查队首阻塞根因并建立隔离工作区
- [completed] 修正 pending 回填与阻塞原因
- [completed] 补回归测试、设计文档和产品清单
- [completed] 运行构建、测试和本体校验
- [pending] 仅提交本任务文件并推送

## 决策记录

- 2026-10-25：pending 子任务是队列，不占写入冲突槽；冲突只按 running 和本次已启动项计算。允许安全回填，提高有效并发。
- 2026-10-25：保留 pending FIFO 顺序；阻塞观测区分 `writeFiles` / `conflictGroup` 冲突与 `max_concurrency`。

## 当前结论

已实现并验证 pending 冲突回填和阻塞原因诊断。构建、116 项相关单测、空白检查、Ontology schema/引用校验及 9 项 Ontology unittest 全部通过。剩余工作是核对远端是否前进、仅提交本任务文件并推送。
