# P0 性能与内存硬化执行计划

- 日期：2026-07-31
- 状态：completed
- 负责人：Loop 协作
- owner：msg_1785460421595_9a96966a875c9 / p0-exec-plan-inventory
- claimed_at：2026-07-31
- claim_ttl：本轮 P0 全部验收前
- handoff_to：`.ch/docs/exec-plans/completed/2026-07/2026-07-31-perf-p0-performance-memory-hardening.md`
- 类型：perf

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [docs：产品、运行时或审计文档写作](./2026-07-31-docs-p0-performance-memory-hardening.md)：同源历史任务；文档计划承接审计回写、状态汇总和产品/运行时说明，本实现不承担文档写作。

以上记录按原计划的实际交付拆分，日期、完成状态与各项验证限制沿用历史记录；下列历史命令及结果不是2026-11-11重新执行的证明。

## 背景

用户原始目标是“你来优化，所有 p0 级别完成”。本轮 P0 范围以 `docs/PERFORMANCE_MEMORY_AUDIT_2026-07-13.md` 为准，覆盖 6 个已确认 P0：Claude abort 接线、扩展停用停止所有运行、OpenCode 原始输出有界且避免全历史重扫、Run Stream 有界且避免全量 DOM 重建、Assistant delta 避免重复完整 Markdown parse、附件上传数量/字节限制。

本计划是后续实现与验收的 active 执行载体。长期事实来源应继续指向原始 Markdown 审计报告、active plan、子任务沟通文件和最终归档记录；不要把 generated recall / memory index 文档作为长期事实来源。

## 目标

1. 按审计报告的6个P0完成性能/内存/生命周期硬化实现，消费原有最小验证证据。
2. 用下列实现状态矩阵逐项说明边界，不把容量上限等同完整优化。
3. 保留热点文件串行实现顺序，避免`src/extension.ts`并发冲突。
4. 独立测试开发不归本记录（原test计划已删除）；审计、产品、运行时文档与后续清单写作交关联docs。

## 范围

- Claude SDK abort controller 接线和停止后 generator 退出验证。
- Extension Host 生命周期停止：deactivate/reload 时停止主进程、并行进程、交互运行和受管 server。
- OpenCode host 输出：stdout/stderr/raw JSONL 有硬字节上限，并移除逐 chunk 全历史 activity 重扫。
- Webview Run Stream：记录数、单条字节、总字节预算，以及增量/窗口化 DOM 更新。
- Webview Assistant delta：流式阶段批量/轻量更新，完成后再进行完整 Markdown finalize，避免每个 delta 解析完整累计内容。
- 附件上传：Webview 与 Extension Host 双端数量、单文件字节、总字节限制和拒绝提示。
- 本范围仅承担六项实现及编译/最小验证证据；独立测试开发不归本记录（原test计划已删除），审计/用户文档写作仍归关联docs。

## 非目标

- 不处理本审计报告中的 P1/P2 项，除非实现 P0 时必须触及同一路径。
- 不进行依赖升级、前端技术栈替换或大规模架构重写。
- 不新增破坏性压测脚本作为默认开发流程；动态压测只作为验收补充。
- 不修改 generated memory index、recall 文档或把生成类召回产物升级为事实源。

## 验收标准

- [x] Claude 运行停止后 SDK query 收到 abort 信号；旧运行结束不会清空新运行的 controller；相关测试通过。
- [x] `deactivate()` 统一调用幂等 stop-all 逻辑，停止主 OpenCode/Codex 进程、parallel runs、interactive runs 和受管 OpenCode server；相关测试通过。
- [x] OpenCode host stdout/stderr/raw JSONL 有明确字节上限；activity 检测改为增量状态或 bounded frame parser，不再每个 chunk 重扫全部历史缓冲。
- [x] Run Stream 每 tab 有记录数、单条字节和总字节预算；overlay 关闭时不构建完整记录 DOM；流式追加不再每个 delta 清空重建完整列表。
- [x] Assistant delta 流式阶段不重复完整 Markdown parse，不依赖每次线性扫描全消息 DOM；完成时进行一次完整渲染或等价低复杂度处理。
- [x] 附件上传 Webview 与 Extension Host 双端校验文件数量、单文件字节和总字节；拒绝场景有中英文提示和边界测试。
- [x] `npm run build` 通过；相关单元测试通过；无法自动化的动态验证有明确记录。

## P0 状态矩阵

| ID | P0 项 | 当前初步状态 | 代码证据 | 仍缺实现 / 后续验证 | 承接建议 |
| --- | --- | --- | --- | --- | --- |
| P0-1 | Claude abort 接线 | 已完成并通过最终验证 | `src/interactive/claudeRunner.ts` 已在 `queryOptions` 写入 `abortController`，`finally` 仅在实例字段仍指向本轮 controller 时清空；`src/test/claudeRunner.test.ts` 覆盖 abort 传递与旧运行不清空新 controller | `npm run build` 通过；指定 dist 单测 114/114 通过 | `p0-lifecycle-stop-guard` 已完成 |
| P0-2 | 扩展停用停止所有运行 | 已完成并通过最终验证 | `src/extension.ts` 已新增停用 guard 与幂等 `stopAllRuns()`，覆盖 activeProcess、parallel runs、interactive runs 和 managed runner；`src/test/extensionDeactivateStopAll.test.ts` 做源码级回归 | `npm run build` 通过；指定 dist 单测 114/114 通过 | `p0-lifecycle-stop-guard` 已完成 |
| P0-3 | OpenCode 原始输出有界并避免全历史重扫 | 已完成并通过最终验证 | `src/cli/commandRunner.ts` 新增 `createOpenCodeStreamActivityTracker()`、64KiB pending line 上限和兼容 `detectOpenCodeStreamActivity()`；`src/extension.ts` one-shot 改用 tracker `updateStdout/updateStderr/snapshot/flush`，不再按 chunk 调 `detectOpenCodeStreamActivity(rawStdout, rawStderr)`；one-shot/parallel/interactive raw stdout/stderr 保持 `AI_TASK_RAW_OUTPUT_MAX_BYTES` bounded tail；`src/openCodeTabStream.ts` 与 one-shot JSONL pending buffer 均加 64KiB 上限 | `npm run build` 通过；指定 dist 单测 114/114 通过 | `p0-opencode-output-incremental` 已完成 |
| P0-4 | Run Stream 有界并避免全量 DOM 重建 | 已完成并通过最终验证 | `p0-webview-stream-attachments` 已补单条字节、累计字节、discard/truncation metadata，并避免 overlay 关闭时重建 records DOM | `npm run build` 通过；指定 dist 单测 114/114 通过 | `p0-webview-stream-attachments` 已完成 |
| P0-5 | Assistant delta 避免重复完整 Markdown parse | 已完成并通过最终验证 | `p0-webview-stream-attachments` 已让流式阶段走轻量 text update，idle/final 再完整 Markdown 渲染，并补 runtime coverage | `npm run build` 通过；指定 dist 单测 114/114 通过 | `p0-webview-stream-attachments` 已完成 |
| P0-6 | 附件上传数量/字节限制 | 已完成并通过最终验证 | `p0-webview-stream-attachments` 已实现 Webview 预检与 Extension Host decoded Buffer 复验，覆盖数量、单文件和总字节限制及中英文提示 | `npm run build` 通过；指定 dist 单测 114/114 通过 | `p0-webview-stream-attachments` 已完成 |

## 已派发子任务

原始协作责任（ID与状态不变）：

| 子任务 ID | 原状态 | 本次类型责任分配 |
| --- | --- | --- |
| `p0-exec-plan-inventory` | completed | 仅写计划/报告的历史工作由关联docs保留，不冒称实现代码 |
| `p0-lifecycle-stop-guard` | completed | 本perf记录承接Claude取消与停用stop-all实现；原test记录已删除，历史验证证据见删除审计；本perf不接回测试开发 |
| `p0-webview-stream-attachments` | completed | 本perf记录承接Run Stream、Assistant delta、附件边界实现；原test记录已删除，历史验证证据见删除审计；本perf不接回测试开发 |
| `p0-opencode-output-incremental` | completed | 本perf记录承接OpenCode输出有界与增量activity实现；原test记录已删除，历史验证证据见删除审计；本perf不接回测试开发 |
| `p0-final-validation-docs` | completed | 原独占build/dist验证作为共享证据；审计/规格写作和归档记录由docs承接 |

## 后续批次建议

1. 最终验收已完成并归档；不再需要派发 P0 子任务。
2. 后续如需继续优化，应从审计报告中的 P1/P2 项另起执行计划，不在本 P0 计划中继续追加范围。
3. 动态压测仍可作为后续增强项：真实大输出、真实 reload 后进程归零和超大附件拒绝链路可用手工/端到端环境补量化数据。

## 影响面

- 代码目录：`src/extension.ts`、`src/interactive/claudeRunner.ts`、`src/cli/commandRunner.ts`、`src/openCodeTabStream.ts`、`src/webview/`。
- 测试目录的历史验证证据见删除审计（不接回测试开发）；审计报告、功能清单及运行时文档影响仍由关联docs记录；本perf不承接这些写作。
- 配置与脚本：不新增依赖；使用现有 `npm run build` 与 node test 流程。

## 风险与缓解

- 风险：`src/extension.ts` 是生命周期和 OpenCode host 输出的共同热点，并发写入容易冲突。
  - 缓解：先完成 lifecycle stop，再派发 OpenCode output incremental 子任务。
- 风险：当前已有部分 bounded tail 代码，后续实现可能误判为 P0 已完成而忽略逐 chunk 重扫和 DOM 全量重建。
  - 缓解：矩阵按“部分已有修复证据/仍缺实现”拆分验收，不用单个 bounded 常量替代完整 P0 验收。
- 风险：Webview script 是字符串化 runtime，改动容易出现运行时引用缺失。
  - 缓解：必须补充 runtime coverage，并执行 build 后的 dist 测试。
- 风险：动态内存和进程残留验证不一定能完全自动化。
  - 缓解：先用单测证明控制流和边界，再记录最小手动/动态验证步骤和结果。

## 验证计划

- 本计划最小验证：`git diff --check`。
- 生命周期验证：`npm run build`；`node --test dist/test/claudeRunner.test.js dist/test/extensionDeactivateStopAll.test.js`。
- OpenCode 输出验证：`npm run build`；`node --test dist/test/boundedText.test.js dist/test/commandRunnerCoverage.test.js dist/test/opencodeCommandRunner.test.js`；增加多 chunk 大输出 activity 检测测试。
- Webview/附件验证：`npm run build`；`node --test dist/test/clipagescriptruntimecoverage.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js`。
- 最终验收验证：`npm run build` exit 0；`node --test dist/test/claudeRunner.test.js dist/test/extensionDeactivateStopAll.test.js dist/test/boundedText.test.js dist/test/commandRunnerCoverage.test.js dist/test/opencodeCommandRunner.test.js dist/test/openCodeTabStream.test.js dist/test/clipagescriptruntimecoverage.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js` exit 0，`tests 114`、`pass 114`、`fail 0`；`git diff --check` exit 0。

## 测试与清单同步

- 测试开发与原始验证/失败明细见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)，本实现记录仅消费验证证据。
- 产品/运行时/审计文档及功能清单写作见关联[docs计划](./2026-07-31-docs-p0-performance-memory-hardening.md#范围与非目标)，不属于本实现范围。

## 决策记录

- 2026-07-31：P0 范围只锚定 `docs/PERFORMANCE_MEMORY_AUDIT_2026-07-13.md` 的 6 个 P0，不继承 generated recall 结论。
- 2026-07-31：OpenCode host 输出 P0 在生命周期子任务完成后串行实施；为覆盖 parallel stream 的未完成 JSONL 行缓存，允许小范围修改 `src/openCodeTabStream.ts`。
- 2026-07-31：当前矩阵允许“部分已有修复证据”状态；最终验收必须同时覆盖有界容量、低复杂度和停止/拒绝行为，不以单点代码证据替代整体通过。
- 2026-07-31：本轮实现子任务只运行 noEmit/source-level/diff-check 验证；`node --test` 依赖 `npm run build` 生成 dist，留给最终独占验收。
- 2026-07-31：最终独占验收已执行 `npm run build`、指定 dist 单测和 `git diff --check`，全部通过；active plan 归档到 completed。

## 当前结论

6 个 P0 均已完成并通过最终独占验收。`npm run build` 通过；指定 dist 单测 114/114 通过；`git diff --check` 通过。审计、产品/运行时写作与计划归档记录见关联docs；原test记录已删除，仅首次断言修复的历史验证证据见删除审计。后续工作如继续推进，应从 P1/P2 性能与内存优化另起计划。

## 任务列表

- [completed] 对照P0矩阵确定六项实现边界；审计/计划写作由关联docs承担。
- [completed] 完成Claude abort接线和扩展停用stop-all生命周期实现。
- [completed] 完成Run Stream、Assistant delta和附件上传边界实现。
- [completed] 完成OpenCode host输出有界与增量解析实现。
- [completed] 消费最终独占build、114/114单测与diff证据；独立测试开发不归本perf（原test计划已删除）。
- [completed] 本实现按原完成口径归档，用户文档/审计回写见关联docs。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
