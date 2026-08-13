# Loop / Graph 子任务 Tab 自动关闭

- 日期：2026-07-24
- 状态：completed
- 负责人：Codex / 协作
- owner：Codex
- claimed_at：2026-07-24
- claim_ttl：1d
- handoff_to：

## 背景

用户要求 Graph 模式子 tab 结束后自己关闭，Loop 模式也一样，不再根据已有配置判断；相关配置可以移除。

## 目标

- Loop 子任务 tab 在子任务正常结束后统一自动关闭，不再读取 `loopAutoCloseSubtaskTabs`。
- Graph 节点 tab 在节点执行结束后统一自动关闭。
- 移除或隐藏用户侧自动关闭配置入口，并同步类型、状态、文档和测试。

## 范围

- Loop 子任务 lifecycle / extension wiring。
- Graph 节点执行完成后的 tab cleanup。
- 工具设置 / Webview 状态 / i18n / tests / specs。

## 非目标

- 不改变主任务 tab 运行态锁定规则。
- 不改变 failed/blocked 节点状态语义；本次只处理子 tab 生命周期。

## 验收标准

- [x] Loop 子任务结束时不依赖配置，成功结束后自动关闭 tab。
- [x] Graph 节点执行结束时自动关闭对应节点 tab。
- [x] `loopAutoCloseSubtaskTabs` 不再作为用户可配置项暴露。
- [x] 相关 build / 单元测试 / diff check 通过。

## 验证计划

- `npm run build`：通过。
- `node --test dist/test/loopSubtaskLifecycle.test.js dist/test/graphExtensionRuntime.test.js dist/test/toolSettings.test.js dist/test/workspaceSettingsStore.test.js dist/test/sessionMessageActionsCoreCoverage.test.js dist/test/clipagescriptruntimecoverage.test.js dist/test/opencodethinkingintegration.test.js`：56/56 通过。
- `node --test dist/test/graph*.test.js`：71/71 通过。
- `node --test dist/test/cliPageStaticRenderCoverage.test.js dist/test/opencodeloopmodewebview.test.js dist/test/sessionMessageActions.test.js`：32/32 通过。
- `git diff --check`：通过。
- `codegraph sync`：通过。

## 任务列表

- [x] 定位 Loop/Graph 子 tab 关闭链路和配置入口。
- [x] 修改 runtime 行为与配置状态。
- [x] 更新测试与文档。
- [x] 验证并归档计划。

## 完成记录

- Loop 子任务、Loop debate 临时 tab 成功结束后固定自动关闭，不再读取或暴露关闭开关；失败、停止或无目标 tab 时不关闭。
- Graph 节点 runner 结束后在 `finally` 中关闭对应节点 tab，并记录关闭/关闭失败日志；主 Graph tab 的运行态保持图级生命周期不变。
- 工具设置、PanelState、Webview DOM/state/i18n、settings message 处理、tool/workspace settings normalizer 中移除 `loopAutoCloseSubtaskTabs`。
- 同步更新当前事实来源文档和兼容入口；历史已完成计划保留旧口径作为历史记录。
