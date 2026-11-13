# Loop 原配置续作恢复分组、配置、模型和思考力度 — 新功能开发

- 日期：2026-09-23
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-23
- claim_ttl：1d
- 类型：feature


### 背景

Loop 群聊“保持原模型”目前只回放 `modelRouting` 里的模型名。任务创建时的 CLI 分组已有 `cli`/`sessionId`，但配置档案和思考力度没有快照；显式续作还可能把任务改写到当前 Tab 的 CLI。

### 目标

选择恢复原配置时，切回原 CLI 分组和会话，应用原配置档案，并使用原主/子模型与思考力度。选择当前配置保持现有迁移行为。没有 `originProfile.configId` 的旧任务不能伪装成可恢复原配置。

### 范围

- Loop 任务记录、群聊继续执行、创建快照、文案、规格和回归测试。

### 非目标

- 不冻结配置档案正文；档案被删或模型已不在该档案中时明确失败。
- 主任务 Tab 直接发送继续仍使用当前 Tab 的 CLI 和配置。

### 验收标准

- [x] 新 Loop 任务写入 `originProfile`（configId、Codex 思考力度、OpenCode variant）。
- [x] 群聊选择原配置时恢复分组、配置、模型和思考力度，且不把任务迁移到当前 CLI。
- [x] 配置缺失或无法应用时不启动续跑。
- [x] 旧任务没有 originProfile 时原配置选项不可用。
- [x] 选择当前配置仍写回 modelRouting，并在能解析到 configId 时更新 originProfile。

### 影响面

- 代码目录：`src/loopTaskStore.ts`、`src/extension.ts`、`src/extensionHost/promptRunRuntime.ts`、`src/panelDiagnostics.ts`、`src/webview/loopGroupChatPanelRenderer.ts`、`src/i18n.ts`

### 风险与缓解

- 风险：恢复会切换当前 CLI 分组和激活配置。
- 缓解：只在用户明确选择原配置时切换；失败不新建任务。

### 任务列表

- [x] 核对接入点
- [x] 持久化 originProfile
- [x] 续作恢复原分组和配置

### 决策记录

- 2026-09-23：原配置以 `originProfile.configId` 为门槛；只恢复档案选择，不快照档案正文。

### 当前结论

已完成。

## 分类依据与真实状态

feature：从仅模型名扩展到原分组/档案/思考力度快照恢复，新增外部能力；test：选择器/coordinator实际更新；docs：清单、规格、本体实际更新。源失败处理写无但结果另记1项本地化失败，两处均保留不掩盖。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
