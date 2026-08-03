# Graph direct 返工恢复修复计划

- 日期：2026-08-03
- 状态：completed
- 负责人：Codex
- owner：codex-direct-rework-recovery
- claimed_at：2026-08-03T09:36:34+08:00
- claim_ttl：已完成，归档后释放
- handoff_to：无

## 背景

最近一次 Graph run `graph_msg_1785683322596_8d0486c3981e8` 在 `review-extension-refactor` 节点失败。直接原因是 `src/extensionHost/promptOneShotRuntime.ts` 仍存在 17 处行尾空白；更大的问题是失败分类已推荐沿 `review_feedback` 回到 `extract-one-shot-runtime`，但 direct 模式当前只重跑同一个 review 节点，无法自动返工修复后继续评审。

## 目标

- 清理当前失败暴露的 `promptOneShotRuntime.ts` 行尾空白。
- 让 direct Graph run 可以在 failed test/review/merge/summary 节点存在 active `review_feedback` / `if_fail` 返工边时自动重置声明范围并继续调度。
- 避免 direct 模式继续落盘不可执行的 `feedback_rollback` 建议。
- 补充测试覆盖 direct 返工恢复和 untracked 新文件行尾空白校验。

## 范围

- Graph run control / runtime 的 direct rework 状态变更。
- Graph 失败分类 recovery 文案。
- Graph scheduler / runtime / run control 相关单元测试。
- 当前新建 runtime 文件的行尾空白清理。
- Graph 设计文档、功能清单与产品规格中 direct 返工能力说明。

## 非目标

- 不恢复新 Graph run 的 worktree/checkpoint/merge-back 默认路径。
- 不新增图编辑器、复杂条件重规划或可视 rollback 预演。
- 不继续扩大 `extension.ts` 入口运行时重构范围。
- 不自动处理范围外 dirty workspace 改动。

## 验收标准

- [x] direct run 中 failed review/test 节点若有 active `review_feedback` / `if_fail` 返工边，会重置目标与声明 scope 为 pending 并继续 tick。
- [x] direct run 不再把可修复的返工建议描述为 `feedback_rollback`。
- [x] untracked 新 TypeScript 文件行尾空白能被定向验证发现。
- [x] 当前 `src/extensionHost/promptOneShotRuntime.ts` 行尾空白清理完成。
- [x] 构建和相关 Graph / runtime 测试通过。

## 影响面

- 代码目录：`src/graph/`、`src/extensionHost/`
- 测试目录：`src/test/`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`
- 配置与脚本：`package.json`、`scripts/check_trailing_whitespace.js`

## 风险与缓解

- 风险：direct rework 无 checkpoint，错误重置范围可能重复执行已通过节点。
- 缓解：只沿 planner 显式声明的 `review_feedback` / `if_fail` metadata scope 执行，记录 `node.direct_rework_requested` 事件和 `rework` 元数据。
- 风险：自动返工循环。
- 缓解：保持节点 `maxAttempts` 扩展规则有限，只在失败节点由分类建议且存在返工边时触发一次 scope reset，后续仍受 attempts 和 idle guard 约束。

## 验证计划

- 最小相关验证：
  - `npm run validate:whitespace -- src/graph/types.ts src/graph/graphFailureClassification.ts src/graph/graphRunControl.ts src/extensionHost/graphRuntime.ts src/test/graphRunControl.test.ts src/test/graphFailureClassification.test.ts src/test/graphExtensionRuntime.test.ts src/test/trailingWhitespaceCheck.test.ts scripts/check_trailing_whitespace.js src/extensionHost/promptOneShotRuntime.ts .ch/docs/design-docs/graph-orchestration-mode.md .ch/docs/product-specs/FEATURE_INVENTORY.md .ch/docs/product-specs/sinitek-cli-plugin-capabilities.md docs/插件功能清单.md .ch/docs/exec-plans/active/2026-08-03-graph-direct-rework-recovery.md`：通过。
  - `git diff --check`：通过。
- 单元自测命令：
  - `npm run build`：通过。
  - `node --test dist/test/graphRunControl.test.js dist/test/graphFailureClassification.test.js dist/test/graphExtensionRuntime.test.js dist/test/trailingWhitespaceCheck.test.js`：29/29 通过。
  - `node --test dist/test/graphScheduler.test.js dist/test/graphNodeLifecycle.test.js dist/test/graphStore.test.js dist/test/graphNodeArtifact.test.js`：34/34 通过。
  - `node --test dist/test/promptOneShotRuntime.test.js dist/test/promptInteractiveRuntime.test.js dist/test/extensionHostExtractionContracts.test.js`：13/13 通过。
- 扩展验证：
  - 本次未跑全量 `npm run test:unit`；已覆盖 Graph run control / failure classification / runtime contract / scheduler / lifecycle / store / artifact / one-shot runtime 相关路径。

## 测试与清单同步

- 单元测试新增/更新：已完成，覆盖 direct rework、failure classification、runtime source contract 和 untracked whitespace checker。
- 单元自测结果：`npm run build` 通过；direct rework / failure / runtime / whitespace 29/29；scheduler / lifecycle / store / artifact 34/34；prompt runtime / extraction contract 13/13。
- 失败处理记录：已记录 `review-extension-refactor` 失败根因、direct checkpoint rollback 不可执行原因，以及 `validate:whitespace` 对 untracked 文件的补洞。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `docs/插件功能清单.md`。
- 相关文档同步：已更新 Graph 设计文档和 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 复盘失败 run 与当前能力边界。
- [x] 实现 direct rework 控制链。
- [x] 接入 runtime 自动返工调度。
- [x] 补充空白校验和回归测试。
- [x] 同步文档并运行验证。

## 决策记录

- 2026-08-03：不恢复 worktree 默认执行；direct rework 只做声明范围重置，不做 git rollback。

## 当前结论

修复完成。direct Graph run 现在具备可执行的自动返工路径：失败分类推荐 `direct_rework` 且显式反馈边可用时，会重置声明范围并继续调度；无法安全判断或缺少反馈边时仍进入 needs-review。当前失败暴露的 untracked 行尾空白也已由 `validate:whitespace` 覆盖。
