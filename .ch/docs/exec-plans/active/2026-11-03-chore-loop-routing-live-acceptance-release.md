# Loop routing live acceptance and 1.7.6 release gate

- 日期：2026-11-03
- 类型：chore
- 状态：blocked
- 负责人：Codex

## 关联计划

- 共同背景：原计划 [`2026-11-03-bugfix-loop-cli-model-routing.md`](2026-11-03-bugfix-loop-cli-model-routing.md) 记录七 CLI 路由修复；已移除测试计划的独立回归开发及历史结果见[测试计划删除审计](../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/active/2026-11-03-loop-routing-release-176.md`）。该审计仅为历史证据入口，不是存活测试计划；本计划仅承接未完成的真实 Loop+ 验收、发布门禁与恢复依赖。
- 原实现、test、chore 三份记录均继承原计划的 `blocked` 状态；test 计划已移除，其原责任和状态仅由[删除审计](../migrations/test-plan-removals/2026-11-11-nov-active.json)记录（`source_old_path`：`.ch/docs/exec-plans/active/2026-11-03-loop-routing-release-176.md`）保留。子模型 429 与未完成的真实验收不能被代码、历史单测或模拟 UI 证据替代。
- 历史运行证据位置（只保留路径，不读取或提交内容）：去敏日志 `/tmp/sinitek-loop-176-live3.log`；失败运行记录 `sinitek-loop-model-live-YEHnb3/failure.json`。这些指针及验收/恢复产物归本 chore 范围，不归 bugfix 实现计划。

## 背景与目标

原目标要求以真实 Loop+ 主/子模型执行证明参数路由，并在完整验收通过后发布 1.7.6。历史记录显示主角色 `gpt-6.1-sol/high` 完成派发，子角色 `gpt-6.1-terra/low` 启动，但三次调用都未获得有效结果；后两次明确失败为 HTTP 429。没有产物，也没有成功验收收口。

## 范围与非目标

- 范围：terra 服务恢复后重跑完整真实 Loop+ 验收，核对主/子模型和 effort、任务产物与 completed 收口；完整门禁通过后，后续获授权负责人另行评估发布条件。
- 非目标：本迁移不执行真实收费 CLI、发布脚本或历史恢复命令；不宣称已发布、已验收或 Extension Host 已升级。
- 当前根级 `AGENTS.md` 明确禁止运行 `scripts/publish_vscode_extension.py`；此处发布指令只作为历史条件保留，不得执行。

## 验收标准

- [ ] 主模型真实派发与子模型真实执行成功，session 证据确认模型名和 effort 正确。
- [ ] 子任务产物有效，主任务完成真实验收并进入 completed。
- [ ] 不把 429、参数核对或自动化测试结果冒充真实成功验收。
- [ ] 服务恢复后核对真实结果文件 `result.txt`，确认产物内容有效、完整任务进入 completed；路径仅作未来恢复时判据，当前没有有效结果文件证据。
- [ ] 记录新运行的真实结果及边界；发布动作遵循当时有效的根级授权与规则，不由本迁移触发。

## 验证计划

- 恢复验收必须单独获得当时有效授权并遵守当前安全规则；本迁移不运行历史恢复命令、真实收费 CLI 或任何发布脚本。
- 原始记录中提及的验证命令和发布流程仅为历史背景；当前根规则明确禁止 `scripts/publish_vscode_extension.py`，不得执行该脚本。任何将来工作须重新评估规则与授权，不把历史指令视为可执行授权。
- 原始三次失败、隔离运行目录与去敏日志路径保留在本 chore 计划；失败及成功判据 `result.txt` 均由本计划承接。本迁移没有读取日志或重跑真实 CLI。

## 当前结论

**blocked**：terra 返回 429，没有有效结果或验收收口。用户明确选择保留真实验收门禁；未发布 1.7.6。恢复依赖服务可用、真实完整验收及当前有效的发布授权。不得把该状态归档为 completed。

## 原始失败与成本风险（历史）

- 三次真实调用中 terra 均未能返回有效结果，后两次明确捕获 `exceeded retry limit, last status: 429 Too Many Requests`。没有产物、没有成功验收收口，因此完整真实测试失败，不能记作通过。
- 原真实调用具有费用及写盘风险，原记录使用临时目录、简单单子任务、限定时间与调用次数。本轮不重跑；任何恢复须有当时有效授权且遵守根级禁令。

## 历史恢复指令（禁止本轮执行）

以下只还原迁移前指令，不是当前授权。当前根规则禁止发布脚本，本轮也不运行收费CLI、历史恢复命令、提交或推送。

- 原真实验证入口为 `npm run build && node scripts/verify_loop_model_routing.js --live`；历史要求任务completed、主/子session模型及effort正确并核对有效`result.txt`。当前三次调用失败、没有有效产物，不能把该历史要求视为已满足。
- 原门禁通过后曾要求 `python3 scripts/publish_vscode_extension.py` 发布1.7.6、不可重复覆盖；该历史指令受当前根禁令覆盖，绝不执行。
- 原文记录用户曾授权提交和推送修复代码，且当轮不运行发布脚本；仅保留此历史决定，不授权本迁移创建提交、推送或发布。
