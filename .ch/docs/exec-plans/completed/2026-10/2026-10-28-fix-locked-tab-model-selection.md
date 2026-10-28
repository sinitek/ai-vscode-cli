# 修复已执行对话标签模型切换反弹

- 日期：2026-10-28
- 状态：completed
- 负责人：Codex / 协作
- owner：Codex
- claimed_at：2026-10-28
- claim_ttl：本任务收尾
- handoff_to：已归档

## 背景

最近的对话标签行为调整允许已执行 Tab 继续切换 CLI 和主/子模型，Webview 与 Panel 消息也已放行。但 `src/extension.ts` 的模型选择包装仍检查永久性的 `executionLocked`，静默丢弃已执行 Tab 的模型写入；Panel 随后回发宿主旧选择，使下拉框看似自动反弹。该路径影响普通模型、Loop 主模型和 OpenCode 主模型，Codex 复现条件尤为直接。

## 目标

已执行对话标签可切换后续请求使用的模型；不改变 CLI 切换确认、会话路由或当前运行请求的模型快照。

## 范围

- 移除 `src/extension.ts` 中模型选择写入对永久 `executionLocked` 的拦截。
- 增加覆盖模型选择宿主入口的回归测试。
- 更新功能清单验证入口。

## 非目标

- 不改变 CLI 切换的会话丢失确认。
- 不改变会话/提示词执行快照和正在运行任务的模型。
- 不处理无关的工作区未提交改动。

## 验收标准

- [x] 已执行 Tab 的普通模型、Loop 主模型、OpenCode 主模型选择均抵达持久化写入。
- [x] CLI 切换仍按既有确认策略工作。
- [x] 回归测试能检测模型写入不会重新受 `executionLocked` 拦截。
- [x] `npm run build` 与相关测试通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/test/session/`
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 配置与脚本：无

## 风险与缓解

- 风险：用户在任务执行期间更改选择，影响到错误的请求。
- 缓解：只改模型选择持久化；每次请求仍在发起时读取并记录自己的执行模型快照。

## 验证计划

- 最小相关验证：执行模型选择回归测试与标签锁定测试。
- 单元自测命令：`npm run build`；`node --test dist/test/session/conversationTabModelSelection.test.js dist/test/session/conversationTabLock.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/extensionHost/cliModelSelectionStrategies.test.js`；`npm run test:unit`
- 扩展验证：完整单测运行结束并记录范围外失败。

## 测试与清单同步

- 单元测试新增/更新：新增模型选择宿主锁定回归测试。
- 单元自测结果：`npm run build` 通过；定向 76 项通过；`npm run validate:whitespace` 通过；Ontology 校验通过。
- 失败处理记录：完整 `npm run test:unit` 为 2127/2163 通过、35 项失败、1 项跳过。失败集中在现有未提交 ZCode/DSH/Grok/Kimi CLI 列表与配置夹具期望，以及部分 Loop Webview harness 缺少 `cliSupportsModelSelection`；本次模型选择定向测试和会话锁定测试均通过，未修改范围外代码。
- 功能清单：补充回归测试入口。
- 相关文档同步：现有 Ontology 与产品规格已要求执行锁定后仍允许模型切换；修复使实现与既有事实对齐，不需更改业务概念。

## 任务列表

- [x] 追踪前后端模型选择调用链
- [x] 移除模型选择的永久锁拦截
- [x] 添加回归测试并同步清单
- [x] 构建并运行定向验证
- [x] 归档计划并记录结论

## 决策记录

- 2026-10-28：保留 CLI 切换锁定/确认规则，仅移除模型选择写入的执行锁检查。`executionLocked` 表示 Tab 已有历史执行，不代表模型配置应冻结。

## 当前结论

已确认反弹根因位于扩展宿主的模型选择包装：UI 开放选择后，宿主仍静默忽略写入并通过 Panel 状态回传旧模型。已移除普通、Loop 和 OpenCode 主模型写入的过期锁拦截；CLI 切换确认仍保持不变。定向验证通过，完整单测的范围外失败已记录。
