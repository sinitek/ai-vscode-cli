# Graph 主 Tab 运行态保持

- 日期：2026-07-24
- 状态：completed
- 负责人：Codex / 协作
- owner：Codex
- claimed_at：2026-07-24
- claim_ttl：1d
- handoff_to：

## 背景

用户指出 Graph 模式一旦正式开始，主会话 tab 应持续处于运行状态，直到整个 Graph 任务结束才变为非运行状态。当前表现可能被节点级执行完成或中间暂停打断，导致主 tab 过早退出运行态。

## 目标

确保 Graph 模式的图级运行态驱动主 tab 的运行状态，而不是由单个节点或子执行流生命周期决定。

## 范围

- Graph 启动、暂停 tick、完成/失败/停止路径的主 tab 运行态维护。
- 补充最小相关单元测试覆盖。
- 同步 Graph 模式设计/产品文档。

## 非目标

- 不改 Graph 节点调度语义。
- 不改 Loop 模式运行态逻辑。
- 不引入自动提交或额外 worktree 生命周期策略。

## 验收标准

- [x] Graph 正式开始后，目标主 tab 一直显示为运行中。
- [x] Graph 到达 sleeping / needs-review 等未完成等待态后，主 tab 继续保持运行态。
- [x] Graph 只有进入 completed / error / stopped 图级结束状态时才释放主 tab 运行态。
- [x] 节点级子任务执行结束不会提前释放主 tab 运行态。
- [x] 相关测试和 build 通过。

## 影响面

- 代码目录：`src/extension.ts`、运行态/面板状态相关模块、相关测试。
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`。
- 配置与脚本：无预期变化。

## 风险与缓解

- 风险：运行态锁未释放导致 UI 卡在运行中。
- 缓解：只在 Graph 图级未结束状态保持 running，在 completed / error / stopped 等图级结束状态释放，并加测试覆盖。

## 验证计划

- 最小相关验证：Graph runtime / panel state 相关单测。
- 单元自测命令：`npm run build`；相关 `node --test dist/test/graph*.test.js`。
- 扩展验证：必要时跑更大范围相关测试。

## 测试与清单同步

- 单元测试新增/更新：更新 `src/test/graphExtensionRuntime.test.ts`，覆盖主 Graph tab 从正式开始到图级结束状态才释放运行态。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphExtensionRuntime.test.js dist/test/graphMainWebview.test.js` 9/9 通过；`node --test dist/test/graph*.test.js` 70/70 通过；`git diff --check` 通过；`codegraph sync` 通过。
- 失败处理记录：无。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `.ch/docs/design-docs/graph-orchestration-mode.md` 和 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 定位主 tab running 状态的设置/释放链路。
- [x] 实现 Graph 图级运行态保持与终态释放。
- [x] 补充/更新测试并同步文档。
- [x] 执行 build 和相关测试后归档计划。

## 决策记录

- 2026-07-24：Graph 主 tab running 应表达“整张图是否仍未结束”，不表达单个节点执行流是否仍在 streaming；sleeping / needs-review 属于未结束等待态，completed / error / stopped 属于视觉运行态释放点。

## 当前结论

已完成：Graph tick 开始时会向主 tab 发送 `runStatus=start`，节点 tab 的 `end` 不再影响主 tab；Graph 只有在 `completed`、`error` 或 `stopped` 时向主 tab 发送释放事件。文档、测试和 CodeGraph 索引已同步。
