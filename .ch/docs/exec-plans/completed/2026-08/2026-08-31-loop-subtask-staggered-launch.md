# Loop 子任务错峰启动

- 日期：2026-08-31
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：2026-08-31
- claim_ttl：本次会话

## 背景

Loop 主任务一次生成多个子任务时，现有调度会在同一执行组内通过 `Promise.all` 同时启动多个 CLI。需要降低瞬时并发和资源争用，让子任务逐个产生，并在相邻启动之间保持 3 秒间隔。

## 目标

多个 Loop 子任务按原有执行计划顺序依次启动；首个子任务立即启动，后续子任务在前一个子任务启动后等待 3 秒再启动。保留失败/停止后跳过尚未派发子任务、重试和可见 Tab 切换行为。

## 范围

- `src/extensionHost/loopOrchestration.ts` 的批量子任务调度。
- 相关单元测试和功能清单/事实文档同步。

## 非目标

- 不改变冲突分组计算、子任务重试间隔或最大重试次数。
- 不改变主任务唤醒、状态持久化和 UI 展示协议。

## 验收标准

- [x] 多个子任务不再通过 `Promise.all` 同时启动；`Promise.all` 仅用于等待已经错峰派发的运行结果。
- [x] 第一个子任务无额外等待，后续每个子任务启动前等待 3000ms。
- [x] 任一子任务失败/停止后，剩余未派发子任务保持跳过语义。
- [x] 测试覆盖首个立即启动、后续 3 秒等待和中断分支。

## 影响面

- 代码目录：`src/extensionHost/loopOrchestration.ts`。
- 测试目录：`src/test/loop/`。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`，必要时补充事实来源。

## 风险与缓解

- 风险：把等待放在错误位置会延迟首个子任务或在失败后继续派发。
- 缓解：使用注入的等待函数/可替换计时器测试，并在每次派发前检查执行中断。

## 验证计划

- 最小相关验证：`npm run build`；运行 Loop 编排相关测试。
- 单元自测命令：`npm run build && node --test dist/test/loop/loopSubtaskLifecycle.test.js dist/test/loop/loopParallel.test.js`。
- 扩展验证：本次不启动 Extension Development Host；仅验证调度单元和构建。

## 测试与清单同步

- 单元测试新增/更新：覆盖错峰等待调度。
- 单元自测结果：通过构建、23 项相关 Node 单测和 9 项 ontology 单测。
- 失败处理记录：无失败；`npm run validate:whitespace` 与 `git diff --check` 均通过。
- 功能清单：已同步 Loop 子任务错峰启动能力。
- 相关文档同步：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/design-docs/loop-debate-multi-agent-mode.md` 和 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。

## 任务列表

- [x] 实现顺序派发和 3 秒间隔。
- [x] 补充回归测试。
- [x] 同步功能清单与本计划验证结果。

## 决策记录

- 2026-08-31：保留执行计划的冲突分组用于并发安全和失败跳过边界；组内子任务按计划顺序错峰启动，已启动的独立任务仍可并行运行，组间继续串行。

## 当前结论

已完成批量子任务错峰启动：同一批次按 3 秒间隔逐个启动，已启动的互不冲突子任务仍可并行运行；任务中断时未启动项会标记为 `skipped`。已通过 `npm run build`、Loop 编排相关 23 项测试、`npm run validate:whitespace`、`git diff --check` 及 ontology 校验和 9 项 ontology 单测。
