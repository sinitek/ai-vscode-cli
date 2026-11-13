# 人工交互超时与编排界面自动打开 — 新功能开发

- 日期：2026-09-30
- 状态：completed
- 负责人：Codex
- owner：human-interaction-timeout-auto-open
- claimed_at：2026-09-30
- claim_ttl：本次实现完成并归档
- 类型：feature


### 背景

Loop、Loop+ 的主任务澄清表单已经落地。Vibe 人工交互弹窗和这些澄清表单目前会一直等待。用户要求在 AI 任务配置中提供默认 10 分钟的超时，超时后由 AI 自行选择最佳方案继续。Loop、Loop+ 开始执行时还要自动打开群聊。

### 目标

- 工具设置“AI任务配置”增加人工交互超时，默认 10 分钟，范围 1–240。
- Vibe 人工交互弹窗和 Loop/Loop+ 主任务澄清表单超时后关闭，不记为拒绝，不进入 `needs-review`，并要求模型按最佳方案继续且不要重复同一问题。
- 经典 Loop、Loop+ 开始或恢复执行时自动打开对应界面。已打开面板不在每个 tick 抢焦点。

### 范围

- 全局工具设置、面板状态、Webview 设置控件和中英文文案。
- `requestHumanInteraction` 与 `waitForOrchestratorClarification` 的超时。
- 经典 Loop、Loop+ 执行入口的一次性打开。

### 非目标

- 不改变拒绝、关闭、停止的现有语义。
- 不持久化跨进程的超时截止时间。扩展重启后重新计时。
- 不移除手动“打开群聊”按钮。

### 验收标准

- [x] 未配置时超时为 10 分钟，非法值归一化到 1–240。
- [x] 超时提交状态为 `completed` 且 `timedOut=true`，文案要求模型自行继续。
- [x] 超时不会把 Loop/Loop+ 打成 `needs-review`。
- [x] 用户在超时前提交或拒绝时，原路径保持不变。
- [x] 三种模式执行入口会打开对应 UI，且不是每个内部 tick 都打开。

### 影响面

- 代码目录：`src/toolSettings.ts`、`src/humanInteraction.ts`、`src/orchestratorClarification.ts`、`src/extension.ts`、`src/extensionHost/`、`src/webview/`、`src/panelStateBuilder.ts`
- 配置与脚本：`~/.sinitek_cli/settings.json` 的 `humanInteractionTimeoutMinutes`

### 风险与缓解

- 风险：超时被误当成拒绝，任务暂停。
- 缓解：超时走提交通道，只更换文案；拒绝仍是 `aborted`。
- 风险：每个 tick 抢焦点。
- 缓解：只在一次执行入口打开；已存在面板的 reveal 使用 `preserveFocus`。

### 任务列表

- [x] 核对现有澄清、设置和打开入口
- [x] 实现超时与自动打开

### 决策记录

- 2026-09-30：超时字段使用 `humanInteractionTimeoutMinutes`，默认 10，范围 1–240。
- 2026-09-30：超时使用 `status=completed` 加 `timedOut=true`，不新增提交状态，避免被拒绝分支截走。
- 2026-09-30：热路径只 resolve 正在等待的 waiter，由原继续逻辑写一次补充要求。
- 2026-09-30：扩展重启不恢复旧截止时间，重新等待一个完整时限。

### 当前结论

已完成。`humanInteractionTimeoutMinutes` 默认 10 分钟，范围 1–240。Vibe 弹窗和主任务澄清表单超时后以 `timedOut` 继续，不进入 `needs-review`。经典 Loop、Loop+ 在执行入口自动打开界面。

## 分类依据与真实状态

feature：新超时政策与执行入口自动开UI；test：超时/设置/Webview/续行实际开发；docs：清单/设计/能力/ontology实际同步。保留任务列表none、isAssistantMarkdownRenderPending未定义及Pros: fastest startup既有失败，未重跑任何业务命令。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
