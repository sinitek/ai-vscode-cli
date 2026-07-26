# Graph memory runtime recall boundary

- 日期：2026-07-25
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-25
- claim_ttl：same-session
- handoff_to：

## 背景

用户要求 Graph 模式默认不触发长期记忆写入；Graph 需要上下文时只能读取已有内容或跳过 recall；generated recall 文件应进入 `~/.sinitek_cli/` 运行态目录，不落到 repo。

## 目标

- Graph 模式入口默认不生成 recall 注入内容。
- Graph 子节点运行不自动写入长期记忆。
- generated recall/index 产物迁移到 `~/.sinitek_cli/` 运行态目录。
- Graph 成功完成并合回后清理残余 git worktree 与对应 Graph 分支。
- 保留普通非 Graph prompt 的长期记忆能力。

## 范围

- memory 路径解析与 generated artifact 写入路径。
- Graph prompt 边界说明。
- Graph 子节点 runPrompt 运行选项。
- Graph 完成态 worktree merge-back 后的 cleanup。
- 相关单元测试与事实来源文档。

## 非目标

- 不改变长期记忆源文件 `.ch/docs/memory/` 与 `.ch/docs/runbooks/PITFALLS.md` 的存储位置。
- 不重构 Graph 调度器或 CLI runner。
- 不新增用户可见设置项。

## 验收标准

- [x] Graph 模式 prompt 入口不会默认调用长期记忆注入。
- [x] Graph 子节点结束后不会自动调用长期记忆写回。
- [x] generated recall/index 文件写入运行态目录而不是工作区 `.ch/docs/generated/memory-index/`。
- [x] 普通 prompt 的长期记忆注入与写回测试仍通过。
- [x] 相关文档说明同步。
- [x] Graph 成功 merge-back 后不残留 worktree 目录、Git worktree 注册项或 `sinitek-graph-*` 分支。

## 影响面

- 代码目录：`src/memory/`、`src/graph/`、`src/extension.ts`、`src/sessionMessageActions.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`docs/`
- 配置与脚本：无

## 风险与缓解

- 风险：Graph 入口仍在分支前生成 recall artifact。
- 缓解：调整 session message 处理顺序并补静态单测。
- 风险：测试写入真实 `~/.sinitek_cli`。
- 缓解：给 memory path resolver 增加可选 runtimeDataDir，测试使用临时目录。

## 验证计划

- 最小相关验证：`npm run build`
- 单元自测命令：`node --test dist/test/longTermMemory.test.js dist/test/sessionMessageActions.test.js dist/test/graphPromptBuilders.test.js dist/test/graphExtensionRuntime.test.js dist/test/graphWorktree.test.js`
- 扩展验证：检查生成路径断言与 Graph memory skip 静态断言。

## 测试与清单同步

- 单元测试新增/更新：`longTermMemory.test`、`sessionMessageActions.test`、`graphPromptBuilders.test`、`graphExtensionRuntime.test`、`graphWorktree.test`
- 单元自测结果：通过 `npm run build`；通过 `node --test dist/test/longTermMemory.test.js dist/test/sessionMessageActions.test.js dist/test/graphPromptBuilders.test.js dist/test/graphExtensionRuntime.test.js dist/test/graphWorktree.test.js`（45/45）；通过 `node --test dist/test/workspaceScaffoldSkillPaths.test.js`（1/1）
- 失败处理记录：首轮 `graphPromptBuilders.test` 仍断言旧 recall 文案，已更新为运行态 recall 边界后重跑通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 与 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- 相关文档同步：已同步 `docs/LONG_TERM_MEMORY_DESIGN.md`、`docs/cli-reference.md`、`docs/插件功能清单.md`、`.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/memory/README.md`、`media/workspace-scaffold/AGENTS.md`

## 任务列表

- [x] 迁移 generated recall 路径到运行态目录
- [x] 阻断 Graph 默认 recall 注入和子节点记忆写回
- [x] 清理 Graph 完成态 merge-back 后的残余 worktree 和 Graph 分支
- [x] 更新测试与文档
- [x] 执行最小验证并记录结果

## 决策记录

- 2026-07-25：Graph 默认跳过自动 recall 生成；如需长期记忆写入，应由任务完成后的主智能体集中处理，不由并发子节点自动写入。
- 2026-07-25：Graph 成功 `git merge --squash` 合回后立即删除 Graph worktree、prune Git worktree 注册项并删除 `sinitek-graph-*` 分支；merge-back 或 cleanup 失败时进入 `needs-review`，保留恢复线索。

## 当前结论

已完成：Graph 入口不再默认注入插件侧长期记忆，Graph 节点 `runPrompt` 传递 `skipLongTermMemoryPersist`，generated recall/index 写入运行态 `~/.sinitek_cli/memory-generated/<workspace>/memory-index/`，成功完成态 merge-back 后会清理残余 worktree 与 Graph 分支。验证通过；仍保留已有历史 `.ch/docs/generated/memory-index/` 产物，不在本次删除或迁移历史文件。
