# 避坑历史归档

这个文件用于保留已修复、已废弃或仅历史版本有效的踩坑复盘。

## 归档规则

- 主文件和未来专题文件只保留仍有行动价值的条目。
- 问题被彻底修复、方案已废弃或只影响历史版本时，将完整条目迁移到这里。
- 归档条目仍需保留首次发现时间、适用版本、修复方式和关联资料，便于审计和追溯。
- 当历史归档数量较多或单文件超过约 500 行时，再按主题拆分历史文件并从本页建立索引。

## Graph 完成后只删 run worktree 但留下空父目录

- 状态：已修复
- 首次发现：2026-07-27
- 适用版本：Graph worktree merge-back cleanup 初版

### 现象
- Graph run 完成并成功合回后，具体 `~/.sinitek_cli/graph-worktrees/<graphRunId>` 已被删除，但用户仍能看到空的 `~/.sinitek_cli/graph-worktrees/` 目录，容易误判为临时 worktree 没有清理。

### 根因
- `cleanupGraphRunWorktree` 只验证并删除具体 run 的 worktree cwd、Git worktree 注册项和 `sinitek-graph-*` 分支，没有在父目录已空时删除 `graph-worktrees` 容器目录。

### 修复方式
- `cleanupGraphRunWorktree` 删除具体 run 目录后，若父目录 basename 是 `graph-worktrees` 且目录为空，则同步删除该空父目录。
- 若父目录下仍有其他 run worktree，保留父目录和其他 worktree 不动。

### 验证方式
- `src/test/graphWorktree.test.ts` 覆盖单个 run 清理后父目录消失，以及两个 run 共用父目录时只清理目标 run、保留另一个 worktree。

### 关联资料
- `src/graph/graphWorktree.ts`
- `src/test/graphWorktree.test.ts`

## Graph 不应把 git worktree 当成硬前提

- 状态：已修复
- 首次发现：2026-07-27
- 适用版本：Graph worktree-only runtime 初版

### 现象
- 用户没有安装 git 客户端、当前工作区不是 git repo，或 git 不支持 `worktree` 时，Graph run 在创建阶段会失败，无法像 Loop 一样直接在当前工作区执行。

### 根因
- Graph run 创建阶段硬调用 `git rev-parse` 和 `git worktree add`，节点执行阶段也硬要求 `run.worktree.cwd`。
- 完成态收束也把 worktree merge-back 视为唯一成功路径；没有 worktree metadata 会被转成 `needs-review`。

### 修复方式
- Graph run 创建时优先使用独立 git worktree；任何 worktree 创建失败都会落盘为 `executionMode=direct` 和 `directExecution.cwd`。
- direct 模式节点继续复用 Graph scheduler 和 `runPrompt`，但 `executionCwd` 指向当前工作区；不创建 checkpoint commit，不做 merge-back/cleanup，不提供自动 rollback。
- worktree 模式保留原有 checkpoint、merge-back、cleanup 和 Feedback rollback 能力。

### 验证方式
- `src/test/graphWorktree.test.ts` 覆盖非 git 目录自动降级 direct workspace。
- `src/test/graphStore.test.ts` 覆盖 direct execution metadata 持久化和 `graph.json` 快照。
- `src/test/graphExtensionRuntime.test.ts` 覆盖 extension direct 分支不会执行 merge-back/checkpoint。

### 关联资料
- `src/graph/graphWorktree.ts`
- `src/graph/graphStore.ts`
- `src/graph/graphPromptBuilders.ts`
- `src/extension.ts`
