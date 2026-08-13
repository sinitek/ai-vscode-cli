# Graph worktree 完成后合回主工作区

- 日期：2026-07-24
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-24T12:12:55Z
- claim_ttl：1d
- handoff_to：

## 背景

Graph 当前已在任务开始时通过 `git worktree add -b sinitek-graph-<runId>` 创建独立 worktree，并在每个节点结束后生成本地 checkpoint commit。但 Graph run 完成后没有把 worktree 分支合回用户当前工作区分支，因此用户在主工作区看不到最终改动；最近 run 记录中存在 worktree 元数据和 checkpoint commit，但 `~/.sinitek_cli/graph-worktrees` 目录为空，说明还需要更明确的完成收束和异常记录。

## 目标

Graph run 完成时，把独立 worktree 分支的最终 HEAD 以不提交的方式合回当前工作区分支，让改动出现在主工作区 working tree / index 中，交给用户审阅和提交。

## 范围

- 新增 Graph worktree merge-back 工具函数。
- 在 Graph completion 路径调用 merge-back，并把结果写入 Graph event / 系统消息。
- 补充 worktree 单元测试和扩展源码覆盖测试。
- 同步 Graph 设计文档、产品规格和功能清单。

## 非目标

- 不自动提交主工作区。
- 不自动解决 merge conflict。
- 不删除 Graph worktree 或 Graph 分支。
- 不为 failed / blocked / needs-review run 做自动合回。

## 验收标准

- [x] Graph 完成后调用 `git merge --squash <graphHead>`，主工作区保留未提交 merge 结果。
- [x] 若主工作区不干净、worktree 缺失或 merge 冲突，Graph run 不伪装合并成功，事件和系统消息给出原因。
- [x] Worktree 单元测试覆盖成功合回和主工作区不干净阻断。
- [x] 构建、相关 Graph 测试、diff check 和 CodeGraph sync 通过。

## 影响面

- 代码目录：`src/graph/graphWorktree.ts`、`src/extension.ts`
- 测试目录：`src/test/graphWorktree.test.ts`、`src/test/graphExtensionRuntime.test.ts`
- 文档目录：`.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/*`
- 配置与脚本：无

## 风险与缓解

- 风险：自动合回覆盖用户本地未提交改动。
- 缓解：合回前检查主工作区 porcelain 状态；非空则拒绝 merge-back 并记录原因。
- 风险：merge 冲突留下半合并状态。
- 缓解：使用 Git 原生 `--squash`；冲突时保留冲突状态并在事件中提示用户处理，不自动 abort。

## 验证计划

- 最小相关验证：`npm run build`
- 单元自测命令：`node --test dist/test/graphWorktree.test.js dist/test/graphExtensionRuntime.test.js`
- 扩展验证：`node --test dist/test/graph*.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js`、`git diff --check`、`codegraph sync`

## 测试与清单同步

- 单元测试新增/更新：`src/test/graphWorktree.test.ts` 覆盖成功 squash 合回和脏主工作区阻断；`src/test/graphExtensionRuntime.test.ts` 覆盖完成态扩展链路。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphWorktree.test.js dist/test/graphExtensionRuntime.test.js` 通过；`node --test dist/test/graph*.test.js` 通过；`node --test dist/test/graph*.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js` 通过；`node --test dist/test/*.test.js` 通过，729 项全通过。
- 失败处理记录：最初 `graphWorktree` 新测例在 macOS `/var` 与 `/private/var` 临时目录规范化上失败，已改为 `fs.realpathSync` 后重跑通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 与 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md`。
- 差异检查：`git diff --check` 通过。
- CodeGraph：`codegraph sync` 通过，报告同步 5 个变更文件。

## 任务列表

- [x] 检查最近 Graph run 日志和现有 worktree/checkpoint 链路。
- [x] 实现 Graph completion merge-back。
- [x] 补充单元测试和扩展源码覆盖。
- [x] 同步设计文档与产品规格。
- [x] 执行构建、相关测试和差异检查。
- [x] 归档执行计划。

## 决策记录

- 2026-07-24：Graph 节点仍在独立 worktree 分支中执行和 checkpoint；只有整个 run `completed` 时才尝试合回当前工作区，且使用不提交 merge，保留用户审阅/提交权。

## 当前结论

最近 Graph run 的 store 和 events 记录了 worktree 路径 `/Users/fangjiawei/.sinitek_cli/graph-worktrees/graph_msg_1784886096750_b5a132c89c0dd8` 以及 checkpoint commit，但该目录当前不存在，`git worktree list` 也只显示主工作区；旧实现没有完成态 merge-back，这就是用户在主工作区看不到 Graph 改动的核心缺口。另一个已 `completed` 的 run `graph_msg_1784884449644_7514470ad6e8a` 事件中存在节点 checkpoint 和 `run.completed`，但没有合回事件；其 worktree 目录、`sinitek-graph-*` 分支和最终 checkpoint commit 当前也不可达。

本次已补齐完成态收束：Graph run 进入 `completed` 后会尝试从独立 worktree HEAD 执行 `git merge --squash <sourceCommit>` 合回当前工作区，保留未提交改动；如果主工作区已有未提交改动、worktree 缺失或 Git 合回失败，则 run 转为 `needs-review` 并把原因写入事件和系统消息，避免用户误以为已经合回。
