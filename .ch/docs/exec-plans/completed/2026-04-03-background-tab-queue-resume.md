# 多 Tab 背景任务队列续跑修复

- 日期：2026-04-03
- 状态：completed
- 负责人：Codex

## 背景

多会话 tab 并行运行时，用户可以在某个 tab 内把后续提示词加入队列，等待当前任务结束后自动继续。当前实现里，如果 tab A 正在执行并且有待续跑队列，用户切到 tab B 再发起任务，tab A 结束后不会继续消费自己的队列，导致多任务链路中断。

## 目标

修复多 tab 场景下后台 tab 任务结束后无法自动续跑本 tab 队列的问题，并避免为了续跑后台队列而错误切换当前激活 tab。

## 范围

- `src/webview/viewContent.ts` 中 tab 维度的队列续跑与发送逻辑。
- `src/extension.ts` / `src/webview/types.ts` 中 `sendPrompt` 协议对“后台 tab 发送但保持当前激活 tab”的支持。
- 最小必要的事实记录与验证说明。

## 非目标

- 不重构整套会话/并发架构。
- 不新增新的队列 UI 或任务编排能力。
- 不引入新的测试框架。

## 验收标准

- [x] 后台 tab 在自身任务结束后，可以继续消费本 tab 的待发送队列。
- [x] 自动续跑后台 tab 队列时，不会强制把当前激活 tab 切回后台 tab。
- [x] 当前激活 tab 的原有发送、停止、队列行为不回归。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/webview/viewContent.ts`、`src/webview/types.ts`、`src/extension.ts`
- 文档目录：`.ch/docs/exec-plans/completed/`
- 配置与脚本：无

## 风险与缓解

- 风险：后台 tab 队列续跑时误用当前 tab 的 CLI / 模型 / 运行态。
- 缓解：发送入口改为显式携带目标 tab，并按目标 tab 解析 CLI；后台自动续跑时保持当前激活 tab 不变。

## 验证计划

- 最小相关验证：`npm run build`
- 扩展验证：手动验证“tab A 排队 -> 切到 tab B 运行 -> tab A 完成后自动续跑且界面停留在 tab B”

## 测试与清单同步

- 单元测试：仓库当前无现成测试基建；本次先做最小改动并记录手动验证点，后续如建立 webview 状态机测试，应补此回归用例。
- 功能清单：本次是既有多 tab 队列行为修复，不新增功能，暂不更新 `FEATURE_INVENTORY.md`。
- 相关文档同步：记录本执行计划与验证结论。

## 任务列表

- [x] 定位多 tab 队列续跑的触发路径与根因。
- [x] 修改 webview 队列续跑为按 tab 发送。
- [x] 修改扩展侧发送协议，支持后台 tab 续跑时保持当前激活 tab。
- [x] 构建验证并回写结论。

## 决策记录

- 2026-04-03：优先做最小修复，不迁移队列状态到扩展侧；继续复用现有 webview 队列状态，但补齐 tab 维度发送能力。

## 当前结论

已完成最小修复：

- webview 的 `flushPendingPromptQueue(tabId)` 改为按目标 tab 消费队列，而不是只看当前激活 tab。
- `dispatchPrompt(payload, options)` 现在会按目标 tab 解析 CLI / 模型，并在后台续跑时携带 `preserveActiveTab`。
- 扩展侧 `sendPrompt` 与 `runPrompt` 支持“向指定 tab 发送但保持当前激活 tab 不变”，从而避免后台续跑抢焦点。

已验证：`npm run build` 通过。

未验证：仓库暂无现成自动化 UI 回归测试，仍建议手动走一遍“tab A 排队 -> 切到 tab B 执行 -> tab A 完成后继续续跑且界面停留在 tab B”的场景。
