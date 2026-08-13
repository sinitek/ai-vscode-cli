# Graph 模式改为项目工作区执行

- 日期：2026-07-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-29
- claim_ttl：本次会话
- handoff_to：

## 背景

最近一次 Graph run `graph_msg_1785286624109_a250c8a3228f3` 在独立 worktree 中执行到 `verify-build` 时，因为隔离 worktree 缺少本地 `node_modules/.bin/tsc` 而进入 `needs-review`。用户明确要求去除 Graph 模式的 worktree 执行，改为像 Loop 模式一样在当前项目工作区直接执行。

## 目标

Graph 模式新运行默认且固定使用当前项目工作区作为节点执行 cwd，不再创建 `~/.sinitek_cli/graph-worktrees/<graphRunId>`、checkpoint commit、merge-back 或 cleanup 流程。

## 范围

- 调整 Graph run 创建时的执行 setup，使 Graph 直接记录 `executionMode=direct` 与当前 workspace cwd。
- 调整 Graph 完成态收束文案和事件，使 direct workspace 是正常路径，而不是 worktree fallback。
- 调整 Graph Retry / Feedback rollback 能力边界：direct 模式保留 failed/blocked 节点重试，但不提供 checkpoint rollback。
- 更新相关单元测试，移除或改写默认 worktree 假设。
- 同步 Graph 设计文档、功能清单和兼容入口文档。

## 非目标

- 不移除历史 run 对旧 worktree metadata 的读取能力。
- 不重写 Graph scheduler、planner、节点 DAG 语义或 GraphRunPanel 视觉层。
- 不为 direct 模式新增自动 git rollback、自动暂存、自动 commit 或工作区清理能力。
- 不改变 Loop 模式已有执行隔离策略。

## 验收标准

- [x] 新 Graph run 不再调用 `git worktree add`，`run.created` 事件记录 direct workspace 执行。
- [x] Graph 节点执行 cwd 为当前项目工作区，节点记录只保存 `executionCwd`，不保存 `worktreeCwd` / checkpoint commit。
- [x] Graph 完成态不再尝试 `merge --squash` 或 cleanup worktree，正常记录 direct workspace 完成事件。
- [x] Graph Retry 在 direct 模式下仍可重置 failed/blocked 节点状态；Feedback rollback 在 direct 模式下明确不可用。
- [x] 相关测试、文档和功能清单同步通过；`npm test` 已通过 766/766。

## 影响面

- 代码目录：`src/graph/graphWorktree.ts`、`src/extension.ts`、`src/graph/graphRunControl.ts`
- 测试目录：`src/test/graphWorktree.test.ts`、`src/test/graphExtensionRuntime.test.ts`、`src/test/graphRunControl.test.ts`
- 文档目录：`.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/cli-reference.md`、`docs/插件功能清单.md`
- 配置与脚本：无预期变更

## 风险与缓解

- 风险：Graph 节点直接写当前工作区后，失败节点没有 checkpoint 自动回滚。
- 缓解：文档和 UI 控制继续明确 direct 模式无 Feedback rollback；Retry 只重新调度节点，不承诺撤销已写改动。
- 风险：历史 worktree run 仍可能被打开或恢复。
- 缓解：保留 worktree 字段类型和 cleanup/merge-back helper，不破坏历史数据读取；仅改变新 run 的 setup。

## 验证计划

- 最小相关验证：`node --test dist/test/graphWorktree.test.js dist/test/graphExtensionRuntime.test.js dist/test/graphRunControl.test.js`
- 单元自测命令：`npm run build`；必要时扩展到 `node --test dist/test/graph*.test.js`
- 扩展验证：`git diff --check`；必要时 `codegraph sync`

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/graphWorktree.test.ts` 与 `src/test/graphExtensionRuntime.test.ts`，覆盖新 Graph run 默认 direct workspace setup 和 runtime 文案。
- 单元自测结果：`./node_modules/.bin/tsc -p ./` 通过；`git diff --check` 通过；最终 `npm test` 通过，覆盖 `npm run build && node --test`，766/766 tests passed。
- 失败处理记录：早期验证曾因本地进程额度 `spawn sh EAGAIN` 未启动 Node 单测；随后全局 `npm test` 已成功通过，无需代码修复。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/插件功能清单.md`。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md`，并在 `.ch/docs/runbooks/PITFALLS_HISTORY.md` 记录 Graph worktree 缺本地依赖坑点。

## 任务列表

- [x] 使用 CodeGraph 定位 Graph worktree 执行入口和影响面。
- [x] 改 Graph run setup 为项目工作区 direct 执行。
- [x] 更新 Graph 控制、完成态和测试断言。
- [x] 同步设计文档、功能清单和兼容入口。
- [x] 执行构建、相关单测和 diff 检查；最终 `npm test` 与 `git diff --check` 均通过。

## 决策记录

- 2026-07-29：按用户要求，Graph 新 run 不再优先创建 worktree；项目工作区 direct 执行成为正常路径，不再视为 fallback。

## 当前结论

已确认阻塞来自隔离 worktree 缺依赖，而不是业务代码失败。本轮已把 Graph 执行方式收口为项目工作区 direct 执行，以减少和 Loop 模式不一致的环境差异。全局 `npm test` 已通过 766/766，`git diff --check` 也已通过；本计划可归档。
