# Graph Worktree Node Commits

- 日期：2026-07-24
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-24 10:30 Asia/Shanghai
- claim_ttl：1 day
- handoff_to：

## 背景

Graph 模式当前通过普通 subtask runner 执行节点，节点实际产物可返回 blocked/failed，但宿主只看 `runPrompt` 是否返回；同时节点没有独立 git worktree 与本地提交检查点，无法支撑 Graph “可回退、可重试节点”的产品语义。

## 目标

让 Graph run 在独立 git worktree 中执行 AI 节点；节点完成后在该 worktree 内创建本地 git 提交，并将节点 artifact JSON 的真实状态回传给 Graph lifecycle；重试节点时回滚到该节点前置 checkpoint。

## 范围

- Graph 专用 worktree 创建、复用、checkpoint commit 和 retry reset。
- Graph executor 读取节点 communication file 的 `## JSON` 状态。
- `runPrompt` 支持 Graph 指定执行 cwd，避免继续使用 Loop 临时 symlink root。
- Graph 类型、事件、文档与最小相关测试同步。

## 非目标

- 不实现复杂分支合并 UI。
- 不把 Graph worktree 自动合并回主工作区。
- 不重写 Graph DAG 调度器。

## 验收标准

- [x] 新 Graph run 记录 worktree 路径和基线 commit。
- [x] Graph 节点在 worktree cwd 内运行，而不是 Loop 临时 symlink root。
- [x] 节点完成后创建本地 git checkpoint commit 并记录到节点。
- [x] 节点 artifact JSON 的 blocked/failed/passed 能驱动 Graph lifecycle。
- [x] retry 节点会 reset 到该节点前置 checkpoint。
- [x] 相关 build/test 通过或记录阻塞原因。

## 影响面

- 代码目录：`src/extension.ts`、`src/graph/*`、`src/promptRunState.ts`
- 文档目录：`.ch/docs/design-docs/graph-orchestration-mode.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/runbooks/PITFALLS.md`
- 配置与脚本：无计划变更

## 风险与缓解

- 风险：worktree 创建失败导致 Graph 无法启动。
- 缓解：检测非 git workspace 时返回 error/needs-review，并写明原因；不影响普通 coding/Loop。
- 风险：retry reset 误影响主工作区。
- 缓解：只对 Graph run 记录的独立 worktree 执行 `git reset --hard`。

## 验证计划

- 最小相关验证：新增/更新 graph runtime、worktree helper、run control 单元测试。
- 单元自测命令：`npm run build`；`node --test dist/test/graph*.test.js dist/test/loopSubtaskExecutionRoot.test.js`
- 扩展验证：`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：新增 `graphWorktree.test.ts`、`graphNodeArtifact.test.ts`，更新 Graph run control/lifecycle/store/runtime 覆盖。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graph*.test.js` 60/60 通过；`git diff --check` 通过。
- 续接验证结果：`npm run build` 通过；`node --test dist/test/openCodeTaskListOverlay.test.js` 4/4 通过；`node --test` 722/722 通过。
- 失败处理记录：误跑 `node --test src/test/*.ts` 因 Node 不直接加载 TS 失败，已改为构建后运行 `dist/test/*.js`；续接时完整测试暴露 `openCodeTaskListOverlay` isolated harness 缺少 `updateGraphMetaForTabFromMessages` stub，已补测试注入并重跑通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 capabilities。
- 相关文档同步：已同步 Graph 设计文档、功能清单和 PITFALLS。

## 任务列表

- [x] 定位 Graph 执行、状态回传、retry 控制链路。
- [x] 实现 Graph worktree/checkpoint helper。
- [x] 将 Graph executor 改为 worktree cwd + artifact JSON 状态回传。
- [x] 将 retry 控制改为回滚 worktree checkpoint。
- [x] 更新测试和文档。
- [x] 运行 build/test 并记录结果。

## 决策记录

- 2026-07-24：采用“每个 Graph run 一个独立 worktree，每个节点一个 checkpoint commit”的最小闭环；节点 retry reset 到节点启动前记录的 base commit。

## 当前结论

已完成：Graph run 使用独立 git worktree，节点结束后创建 checkpoint commit；executor 解析节点 `## JSON` 状态，retry 可 reset 到节点 base commit。
