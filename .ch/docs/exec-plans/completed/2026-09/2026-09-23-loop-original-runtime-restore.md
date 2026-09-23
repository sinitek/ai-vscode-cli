# Loop 原配置续作恢复分组、配置、模型和思考力度

- 日期：2026-09-23
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-23
- claim_ttl：1d

## 背景

Loop 群聊“保持原模型”目前只回放 `modelRouting` 里的模型名。任务创建时的 CLI 分组已有 `cli`/`sessionId`，但配置档案和思考力度没有快照；显式续作还可能把任务改写到当前 Tab 的 CLI。

## 目标

选择恢复原配置时，切回原 CLI 分组和会话，应用原配置档案，并使用原主/子模型与思考力度。选择当前配置保持现有迁移行为。没有 `originProfile.configId` 的旧任务不能伪装成可恢复原配置。

## 范围

- Loop 任务记录、群聊继续执行、创建快照、文案、规格和回归测试。

## 非目标

- 不改变 Graph 继续选择。
- 不冻结配置档案正文；档案被删或模型已不在该档案中时明确失败。
- 主任务 Tab 直接发送继续仍使用当前 Tab 的 CLI 和配置。

## 验收标准

- [x] 新 Loop 任务写入 `originProfile`（configId、Codex 思考力度、OpenCode variant）。
- [x] 群聊选择原配置时恢复分组、配置、模型和思考力度，且不把任务迁移到当前 CLI。
- [x] 配置缺失或无法应用时不启动续跑。
- [x] 旧任务没有 originProfile 时原配置选项不可用。
- [x] 选择当前配置仍写回 modelRouting，并在能解析到 configId 时更新 originProfile。

## 影响面

- 代码目录：`src/loopTaskStore.ts`、`src/extension.ts`、`src/extensionHost/promptRunRuntime.ts`、`src/panelDiagnostics.ts`、`src/webview/loopDebatePanelRenderer.ts`、`src/i18n.ts`
- 文档目录：产品规格、功能清单、Loop 设计说明、ontology

## 风险与缓解

- 风险：恢复会切换当前 CLI 分组和激活配置。
- 缓解：只在用户明确选择原配置时切换；失败不新建任务。

## 验证计划

- 最小相关验证：`npm run build` 后运行 Loop 继续选择相关单测。
- 单元自测命令：`node --test dist/test/loop/continueModelChoice.test.js dist/test/loop/loopDebateCoordinator.test.js dist/test/loop/loopDebatePanel.test.js`
- 扩展验证：不跑全量单测。

## 测试与清单同步

- 单元测试新增/更新：continue model choice、Loop 群聊 coordinator。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/loop/continueModelChoice.test.js dist/test/loop/loopDebateCoordinator.test.js` 7/7 通过；Loop 群聊面板相关 2 项通过。`covers Loop debate panel lifecycle` 因本机工具设置语言为中文渲染中文面板，断言仍要求英文文案，与本次改动无关。
- 失败处理记录：无。
- 功能清单：更新 Loop/Graph 模型路由行中的 Loop 续作描述。
- 相关文档同步：capabilities、loop debate 设计说明、ontology。

## 任务列表

- [x] 核对接入点
- [x] 持久化 originProfile
- [x] 续作恢复原分组和配置
- [x] 测试与文档

## 决策记录

- 2026-09-23：原配置以 `originProfile.configId` 为门槛；只恢复档案选择，不快照档案正文。Graph 不在本次范围。

## 当前结论

已完成。Graph 继续选择未改。
