# Graph worktree dirty workspace 合回修正

- 日期：2026-07-24
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-24T18:50:00+08:00
- claim_ttl：1d
- handoff_to：

## 背景

刚执行的 Graph run `graph_msg_1784899942908_483d661278687` 已在独立 worktree 中完成并生成 checkpoint commits，但合回目标仓库 `/Users/fangjiawei/sinitek/week_report` 时失败。日志显示失败原因为目标仓库有未提交内容；实际状态只有不相关的未跟踪 `.ch/` 目录，因此当前“任何 dirty 都拒绝”的策略过度保守。

## 目标

Graph 完成态合回应让 Git 尝试 `git merge --squash`，允许目标工作区存在不相关未提交内容；只有 Git 真实发现冲突、覆盖风险、worktree 缺失或其它合并错误时才进入 `needs-review`。

## 范围

- 调整 Graph worktree merge-back helper。
- 更新 Graph worktree 单元测试。
- 同步 Graph 设计文档和产品规格。
- 复核最近 Graph run 的真实日志与目标仓库状态。

## 非目标

- 不自动提交合回结果。
- 不自动解决 Git 冲突。
- 不清理 Graph worktree 或分支。
- 不静默改写旧失败 run；若人工补合回成功，需追加事件说明。

## 验收标准

- [x] 目标工作区只有不相关 dirty 内容时，Graph worktree 仍能 squash 合回。
- [x] 目标工作区存在会被 Graph diff 覆盖的本地改动时，合回仍失败并保留错误。
- [x] Graph 文档不再声称“工作区不干净”本身会阻断。
- [x] 相关测试和构建通过。

## 影响面

- 代码目录：`src/graph/graphWorktree.ts`
- 测试目录：`src/test/graphWorktree.test.ts`
- 文档目录：`.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/*`
- 配置与脚本：无

## 风险与缓解

- 风险：dirty 工作区合回可能混合用户已有改动和 Graph 改动。
- 缓解：继续使用 Git 原生 merge 检查；只有 Git 可安全应用时才落入 working tree / index，冲突和覆盖风险交给 `needs-review` 暴露。

## 验证计划

- 最小相关验证：`npm run build`
- 单元自测命令：`node --test dist/test/graphWorktree.test.js dist/test/graphExtensionRuntime.test.js`
- 扩展验证：`git diff --check`、`codegraph sync`

## 测试与清单同步

- 单元测试新增/更新：`src/test/graphWorktree.test.ts` 更新 dirty workspace 合回测试，并新增重叠改动失败测试。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphWorktree.test.js dist/test/graphExtensionRuntime.test.js` 10/10 通过；`node --test dist/test/graph*.test.js` 72/72 通过；`git diff --check` 通过；`codegraph sync` 同步 3 个变更文件。
- 失败处理记录：最近 run 的旧失败由过度保守 dirty 检查导致；本次手动执行 `git merge --squash 5c48f83cdd0e44762ec3b507f65d67ae15e38b5f` 成功合回，不创建提交。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 复核最近 Graph run 日志和目标仓库 dirty 状态。
- [x] 调整 merge-back 策略和单元测试。
- [x] 同步文档与功能清单。
- [x] 执行构建、相关测试和差异检查。
- [x] 归档执行计划。

## 决策记录

- 2026-07-24：Graph 完成态合回不应把“工作区有任何未提交内容”作为失败条件；应由 Git 判断具体 Graph diff 是否能安全应用。
- 2026-07-24：对已失败的历史 run，人工补合回成功后同时修正 `graph.json` / store 状态为 `completed`，并追加 `run.updated` 事件说明是 retry 后合回，不抹掉原失败事件。

## 当前结论

最近 Graph run 的 worktree 在 `/Users/fangjiawei/.sinitek_cli/graph-worktrees/graph_msg_1784899942908_483d661278687`，最终 HEAD 为 `5c48f83cdd0e44762ec3b507f65d67ae15e38b5f`，新增 `employee-management-prototype/` 三个静态文件。合回目标 `/Users/fangjiawei/sinitek/week_report` 当前分支为 `master`，旧失败时只有未跟踪 `.ch/`，因此旧策略造成了不必要的 `needs-review`。

本次已修正运行时策略：`mergeGraphRunWorktreeToWorkspace` 不再预先拒绝 dirty workspace，而是直接让 `git merge --squash <sourceCommit>` 判断能否安全应用。未来 Graph run 如果目标仓库只有不相关未提交内容，会照常合回；如果 Graph diff 会覆盖本地改动或发生冲突，Git 仍会失败，扩展继续把 run 置为 `needs-review` 并记录原因。

本次也已把历史 run 的产物补合回 `/Users/fangjiawei/sinitek/week_report`：`employee-management-prototype/app.js`、`index.html`、`styles.css` 现在出现在目标工作区，处于未提交 `A` 状态；该目标仓库原有未跟踪 `.ch/` 仍保留。Graph 事件末尾已追加 “merged back after retry” 记录，`graph.json` 和 run store 状态已修正为 `completed`。
