# 定时任务按执行时模式运行 — 新功能开发

- 日期：2026-09-15
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-15
- claim_ttl：本次会话
- 类型：feature
- 原计划：`.ch/docs/exec-plans/completed/2026-09/2026-09-15-scheduled-task-runtime-mode.md`

## 本类型目标

定时任务到期按目标CLI当前interactiveMode及Loop配置路由，旧字段只兼容；保留9/19改为创建时选中模式的后续决定。

## 范围与所有权

- 定时任务到期按目标CLI当前interactiveMode及Loop配置路由，旧字段只兼容；保留9/19改为创建时选中模式的后续决定。
- 本记录只承担 新功能开发；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 定时任务到期按目标CLI当前interactiveMode及Loop配置路由，旧字段只兼容；保留9/19改为创建时选中模式的后续决定。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本类型范围核对原实现/治理结果与兼容边界；历史构建、测试或失败证据由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管（没有测试开发时保留本类型原验证记录），迁移不产生新的产品通过声明。

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [2026-09-15-docs-scheduled-task-runtime-mode.md](2026-09-15-docs-scheduled-task-runtime-mode.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

定时任务目前在创建时保存 `interactiveMode` 和 Loop 执行配置，任务到期后直接使用持久化旧值。用户切换当前 CLI 的模式后，任务可能仍按创建时的 Loop 模式执行。

### 目标

定时任务到期执行时，以任务目标 CLI 在当时的当前模式为准；Loop 的执行子模式也读取执行时配置，避免沿用过期的模式选择。

### 范围

- 调整 `executeScheduledTask` 的模式解析与 Prompt 构建。
- 保留已有任务记录字段和创建流程，兼容历史持久化数据。

### 非目标

- 不改变立即发送、Loop 本身的调度语义。
- 不迁移定时任务存储格式，不新增重复执行能力。

### 验收标准

- [x] 任务创建后切换目标 CLI 到 `loop`，到期执行进入 Loop。
- [x] 到期时 Loop 执行子模式使用当前配置，旧记录字段仅保留用于历史数据兼容。

### 影响面

- 代码目录：`src/extension.ts`、必要时 `src/scheduledTaskStore.ts`。

### 风险与缓解

- 风险：目标 CLI 的当前模式与任务保存时不同，可能改变用户原先预期。
- 缓解：按用户明确的“执行时模式”语义读取 workspace 当前配置；历史记录字段继续保留但不覆盖当前配置，缺少配置时使用既有 coding 默认值。

### 任务列表

- [x] 梳理定时任务创建、存储和执行调用链
- [x] 实现执行时模式解析和 Loop 配置读取

### 决策记录

- 2026-09-15：执行时模式以目标 CLI 的 `workspaceSettings.interactiveModeByCli` 当前值为准；任务记录中的 `interactiveMode` 保留为历史兼容字段，不参与到期路由。

### 当前结论

后续说明：2026-09-19 起，定时任务改为按创建时选中的 Vibe/Loop 及该模式已保存配置执行；执行时工作区模式仅作为旧任务缺字段时的回退。详见 `.ch/docs/exec-plans/completed/2026-09/2026-09-19-scheduled-task-selected-mode.md`。
已完成：`executeScheduledTask` 在任务进入 running 后按 `task.cli` 读取 workspace 当前 `interactiveMode` 与 Loop 执行子模式；任务记录旧字段继续保留以兼容历史数据。构建、相关回归测试和 ontology 校验通过；全量单测仅保留一个范围外的既有 Tasklist 断言失败。本计划可归档。

## 分类依据与真实状态

feature：按明确需求改变创建/执行时模式政策，不以版本不明的bug名义处理；test：解析及入口契约实际新增覆盖；docs：产品与ontology实际同步。23/23、9/9及全量957/958 Tasklist既有失败、9/19后续决定保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
