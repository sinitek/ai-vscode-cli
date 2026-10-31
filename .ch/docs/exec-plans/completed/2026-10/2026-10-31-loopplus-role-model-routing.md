# Loop+ 全栈与拆分角色路由

- 日期：2026-10-31
- 状态：completed
- 负责人：协作
- owner：loop-plus-routing attempt
- claimed_at：2026-10-31
- claim_ttl：已归档
- handoff_to：主审

## 背景

Loop+ 原先只有一组子模型。已有改动增加了 `taskType=backend/frontend/general`、`codingDelivery` 和子-前端配置。用户最终要求不再固定拆成前后端：默认全栈，只有取消「全栈」后才按前后端路由。主审只编排和验收。

## 目标

- 单一 `loopSubtaskMode`：`fullstack` / `split`。新 UI 和新任务缺省 fullstack。
- fullstack：backend、frontend 和未归类编码使用子-全栈完整 CLI、configId、model、thinking。
- split：frontend 用子-前端；backend 和其它编码用子-后端。
- 两种模式的 general 都只做分析，并使用主模型完整配置。编码冲突拒绝。子配置失败不回退主模型编码。
- 三套配置分别保存。切换模式只显隐和改路由。全栈角色只在首次缺失时从原子模型初始化一次。
- Loop+ 标签为「主-思考」；工具栏最左是原生「全栈」复选框；可见角色有即时问号说明。
- 旧任务：无模式且无独立前端配置时，fullstack 沿用原子模型；已有前后端独立配置但无模式时按 split。

## 范围

- 决策、记录、存储、发送、排队、启动、恢复、重试、reprompt、续跑。
- Webview 仅 Loop+ 展示开关、全栈行和帮助。
- 单测、功能清单、调度设计、ontology。

## 非目标

- 不重构 Loop+ 调度、批次屏障或验收队列。
- 不改变经典 Loop、Graph、普通聊天和 OpenCode 官方 `small_model`。
- 不把提示词说成强制只读沙箱。
- 不因为模型名相同而拒绝合法配置。
- 不修改父任务 `loop-tasks.json`、active ids、调度快照或其它 attempt 报告。

## 验收标准

- [x] 默认 fullstack 时前端、后端和未归类编码都解析到全栈 CLI、configId、model、thinking。
- [x] split 的两类编码各自对应；两种模式的 general 取主配置；编码冲突被拒绝。
- [x] 子配置缺失或跨 CLI 无 configId 时失败，不回退主模型。
- [x] 同 CLI 不同档案不串模型；模式来回切换保留三套设置；显式空模型与缺失配置可区分。
- [x] 旧数据迁移符合兼容规则；未知模式拒绝。
- [x] 主提示注入 fullstack / split 约束；未传模式的旧调用仍描述 split。
- [x] Loop+ 静态结构含「全栈」复选框、问号和三套角色行；经典标签仍是「主模型 / 子模型」。
- [ ] 浏览器冒烟与真实 Extension Host 启动分开记录。见本次 attempt 报告。

## 影响面

- 代码：`src/loopPlusSubtaskMode.ts`、`src/loopTaskStore.ts`、`src/subtaskCliRoute.ts`、`src/modelSelectionStore.ts`、`src/continueModelChoice.ts`、`src/sessionMessageActions.ts`、`src/extension.ts`、`src/extensionHost/`、`src/webview/`
- 文档：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`

## 风险与缓解

- 风险：同一 CLI 的活动配置仍由既有 `applyConfigById` 绑定到本次 configId。并发切换会被「任务配置已被新的切换请求替代」拒绝，不新增第二套全局切换。
- 风险：Webview 帮助浮层使用 `position: fixed`，避免模型行 `overflow` 裁切。
- 风险：浏览器只能用隔离 HTML 和模拟 `acquireVsCodeApi`，不能代替 Extension Host。

## 验证计划

- `npm run build`
- `node --test` 覆盖 `loopPlusSubtaskMode`、`subtaskCliRoute`、`continueModelChoice`、`loopPlusPromptBuilders`、`loopPlusDecision`、`loopPlusOrchestration`、`loopPlusRuntimeWiring`、`loopTaskStore`、`sessionMessageActions`、`loopSubtaskCliRoute`、`loopPlusFullstackMode`、`cliPageStaticRenderCoverage`、`codexdualmodelwebview`、`opencodedualmodelwebview`、`loopPlusModeEntry`
- Chromium 冒烟单独记录。

## 测试与清单同步

- 单元测试新增/更新：`src/test/loop/loopPlusSubtaskMode.test.ts`、`src/test/webview/loopPlusFullstackMode.test.ts`、`src/test/extensionHost/loopPlusPromptBuilders.test.ts`
- 单元自测结果：见 attempt 报告
- 功能清单：已同步
- 相关文档同步：调度设计与 ontology 已同步

## 任务列表

- [completed] 定义 loopSubtaskMode 与三套角色配置契约
- [completed] 接通决策、存储、调度、启动与重试
- [completed] 接通 Loop+ 全栈开关、主-思考和即时帮助
- [completed] 补回归测试并执行 build
- [completed] 同步清单、设计与 ontology

## 决策记录

- 2026-10-31：`taskType` 仍只存在于子任务决策和子任务记录。`loopSubtaskMode` 只存在于根任务和输入区设置。
- 2026-10-31：后端继续复用 `loopSubtask*`、`modelRouting.subtask`、`originProfile.subtaskThinkingMode`。前端使用 `loopSubtaskFrontend*`、`modelRouting.subtaskFrontend`、`originProfile.subtaskFrontendThinkingMode`。全栈使用 `loopSubtaskFullstack*`、`modelRouting.subtaskFullstack`、`originProfile.subtaskFullstackThinkingMode`。
- 2026-10-31：`general` 读取 `task.cli`、`originProfile.configId`、`modelRouting.main`、`originProfile.mainThinkingMode`。
- 2026-10-31：不新增关键词扫描器。编码冲突只看结构化 `writeFiles` 与 `codingDelivery`。
- 2026-10-31：无模式且 `subtaskFrontend` 有身份时迁移为 split；否则迁移为 fullstack 并沿用原子 `subtask` 路由。显式模式优先。非法非空模式写入 `loopSubtaskModeInvalid` 并在执行时拒绝。
- 2026-10-31：显式模型用 `loopRoleExplicitModelByConfigId` 保存，空字符串是 CLI 默认模型。`loopFullstackRoleSeededByConfigId` 防止重复初始化。

## 当前结论

实现已提交给主审核对。浏览器与 Extension Host 证据以 attempt 报告为准，不把单测结果当成浏览器通过。

## 归档说明

- 2026-10-31：本计划从 `active/` 归档到 `completed/2026-10/`。归档依据是实现完成，不是重新验证：任务列表五项实现任务均已 completed；`src/loopPlusSubtaskMode.ts`（模式枚举、`readLoopSubtaskModeField`、`resolveStoredLoopSubtaskMode`）存在，`src/subtaskCliRoute.ts`、`src/sessionMessageActions.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/extensionHost/loopPlusPromptBuilders.ts` 已按 `loopSubtaskMode` 路由，`src/webview/viewContentHtml.ts` 已输出「全栈」复选框与子-全栈角色行。
- 验证状态沿用文档既有记录，本次归档未重跑构建、单测、浏览器或真实 Extension Host。
- 未验证事实保持原样：验收标准最后一项 `浏览器冒烟与真实 Extension Host 启动分开记录` 仍为未勾选 `[ ]`；`## 测试与清单同步` 的“单元自测结果：见 attempt 报告”未在本计划内展开，仓库内也未检索到该 attempt 报告文件。
- 全部验收项保持归档前的勾选状态，未改动任何 `[ ]`，未把单测结果改写成浏览器或真实宿主通过。
