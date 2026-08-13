# Graph 无 git/worktree 直接工作区降级

- 日期：2026-07-27
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-27
- claim_ttl：1d
- handoff_to：

## 背景

当前 Graph 模式默认创建 git worktree，并依赖 `git worktree add/remove/prune`、checkpoint commit 和完成态 `git merge --squash` 合回。用户指出如果本机没有 git 客户端，或 git 版本/仓库不支持 worktree，Graph 不应直接不可用；期望可像 Loop 一样直接在当前工作区执行。

## 目标

- Graph run 启动时优先使用独立 git worktree。
- 如果 git 不存在、当前目录不是 git repo、或 `git worktree` 创建失败，则自动降级为 direct workspace 模式。
- direct workspace 模式下节点直接以当前工作区为 cwd 执行，不创建 checkpoint commit，不做 merge-back，不做 worktree cleanup。
- UI/事件/提示词/文档明确提示 direct 模式的限制，避免用户误以为有隔离和回滚。

## 范围

- Graph run 创建、节点执行 cwd 解析、checkpoint/merge-back 分支。
- Graph worktree helper 的能力探测/创建结果。
- Graph Prompt 中的执行模式说明。
- Graph 相关单元测试和产品/设计文档。

## 非目标

- 不实现 direct 模式的自动回滚、diff 预览或冲突恢复。
- 不改变 Loop 模式实现。
- 不新增用户设置开关；本次按运行时能力自动降级。
- 不要求用户安装 git，也不在扩展内捆绑 git。

## 验收标准

- [x] 有 git/worktree 可用时仍走现有 isolated worktree 流程。
- [x] git 不可用或 worktree 创建失败时 Graph run 能创建并执行节点，cwd 为当前工作区。
- [x] direct 模式完成时不会调用 merge-back/cleanup/checkpoint git 命令，也不会因缺少 worktree 失败。
- [x] direct 模式 Retry 只在当前工作区状态上重跑，不尝试 git reset；Feedback rollback 不开放。
- [x] 定向 build/test 通过，文档和功能清单同步。

## 影响面

- 代码目录：`src/graph/`、`src/extension.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`
- 配置与脚本：无

## 风险与缓解

- 风险：direct 模式会直接修改用户工作区，没有 Graph worktree 隔离。
- 缓解：事件、系统消息和节点 prompt 明确标注执行模式与限制；不声称支持 checkpoint/rollback。
- 风险：旧测试依赖 worktree 字段存在。
- 缓解：保留 worktree 模式字段，新增 direct 模式字段并保持旧 store 兼容。

## 验证计划

- 最小相关验证：Graph worktree helper、Graph extension runtime 文本护栏。
- 单元自测命令：`npm run build`；`node --test dist/test/graphWorktree.test.js dist/test/graphExtensionRuntime.test.js dist/test/graphRunControl.test.js`
- 扩展验证：`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：`graphWorktree.test.ts`、`graphStore.test.ts`、`graphExtensionRuntime.test.ts`、`graphRunControl.test.ts`。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphWorktree.test.js dist/test/graphStore.test.js dist/test/graphExtensionRuntime.test.js dist/test/graphRunControl.test.js` 通过，34/34 pass。
- 扩展验证结果：`git diff --check` 通过。
- 失败处理记录：新增 direct 控制测试时曾因复用 `review` 节点触发 `passed_descendants` 保护；已改为独立 `direct-failed` 节点覆盖 direct retry，并补充清理 `executionCwd` 的实现。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 Graph 设计、能力规格和避坑历史文档。

## 任务列表

- [x] 确认 Graph 对 git/worktree 的依赖点。
- [x] 实现 worktree 能力探测和 direct workspace 降级。
- [x] 更新 Graph 运行文案、Prompt 和控制限制。
- [x] 补充测试、文档并运行验证。

## 决策记录

- 2026-07-27：direct workspace 是自动降级路径，不提供隔离、checkpoint、retry reset、feedback rollback 或完成态 merge-back；这些能力仅在 worktree 模式可用。direct Retry 仍可重跑节点，但只基于当前工作区状态继续执行。

## 当前结论

已完成 direct workspace fallback 的类型、store、runtime、prompt、控制逻辑、测试和文档改动。Graph 现在优先使用 git worktree；git/worktree 不可用时自动降级到 direct workspace，不提供 checkpoint、merge-back、cleanup 或 Feedback rollback。
