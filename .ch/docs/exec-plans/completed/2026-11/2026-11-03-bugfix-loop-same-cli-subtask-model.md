# Loop / Loop+ 同 CLI 子模型绑定修复

- 日期：2026-11-03
- 状态：completed
- 类型：bugfix
- 负责人：Codex

## 关联计划

- 共同背景与依赖（测试证据）：[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-loop-same-cli-subtask-model.md`）。
- 共同背景与依赖（docs）：[`2026-11-03-docs-loop-same-cli-subtask-model.md`](2026-11-03-docs-loop-same-cli-subtask-model.md)。

## 背景与目标

同 CLI 下主、子模型选择不同模型时，子任务可能使用主模型。当前源码与本机启动日志确认：经典 Loop 只在跨 CLI 时注入已解析的子任务模型；Loop+ 全栈、前端下拉未独立设置时显示已有子模型，但提交仅取独立设置，丢失显示值。

## 范围与非目标

- 修复经典 Loop 已绑定模型、思考力度传递以及 Loop+ 新建、改用当前配置继续时的命名角色模型快照。
- 同/跨CLI、连续会话、独立选择、CLI默认和缺失路由的测试开发历史记录见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-loop-same-cli-subtask-model.md`）；本计划承接运行时模型传递与快照修复。
- 不修改 CLI 协议、用户本地配置、任务历史或模型目录，不启动付费模型任务。

## 验收标准

- 同 CLI 的子任务使用任务已绑定模型，不受主模型或旧 prompt 覆盖；新会话、连续会话行为一致。
- Loop+ 全栈和前端实际提交的模型与下拉显示一致；独立设置优先，显式 CLI 默认不回落到子模型。
- 跨 CLI 和无配置拒绝路径不回归；构建及相关测试通过。
- 文档交付证据见 [`2026-11-03-docs-loop-same-cli-subtask-model.md`](2026-11-03-docs-loop-same-cli-subtask-model.md)。

## 影响面与风险

- 代码：`src/extensionHost/loopOrchestration.ts`、`src/webview/viewContentScript/taskListAndUi.ts`、`src/continueModelChoice.ts`。
- 测试：`src/test/extensionHost/subtaskCliExecution.test.ts`、`src/test/webview/loopPlusFullstackMode.test.ts`、`src/test/loop/continueModelChoice.test.ts`。
- 风险：将缺失独立设置与显式空模型混淆；通过 null 与空字符串分流保持默认语义。
- 回滚：撤回本次局部代码改动，无持久化格式或数据迁移。

## 验证计划

- 先补测试并执行 `npm run build` 与最小相关单测，确认修复前失败。
- 修复后执行相关测试，扩大到 Loop、Loop+、Webview 与 CLI 参数路径。
- 检查本机历史启动参数与持久化模型路由，不输出或复制私有提示词、密钥。
- 如可用，真实 Chromium 执行 Webview 脚本验证下拉选择和请求快照；不更改界面样式。
- 执行 `git diff --check`、ontology 校验。

## 测试与清单同步

- 测试开发/历史结果及失败分类见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-loop-same-cli-subtask-model.md`）。
- 文档交付证据见 [`2026-11-03-docs-loop-same-cli-subtask-model.md`](2026-11-03-docs-loop-same-cli-subtask-model.md)。
- Ontology：已补现有角色模型路由规则及代码/测试来源，结构校验通过，skill 的 9 条 Python 测试通过。

## 任务列表

Tasklist:
- [completed] 定位子模型参数覆盖与日志证据
- [completed] 修复模型传递；回归开发的历史记录见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-loop-same-cli-subtask-model.md`）。
- [completed] 验证构建；相关事实文档由关联 `docs` 计划维护

## 当前结论

核心修复及回归完成；浏览器发现并补齐同 CLI 前端身份遗漏，继续配置解析也改用相同的模型回退规则。Chromium 已覆盖经典 Loop、全栈继承、全栈独立选择、拆分前端四个真实 Webview 提交场景，核对模型下拉、请求、当前配置继续解析、宿主路由及 Codex thread/turn 参数；控制台、页面、请求错误均为零。主模型始终为 `gpt-6.1-sol`，子模型显示与提交均为 `gpt-6.1-terra`，独立选择例外按对应选择执行。

浏览器结果和截图位于 `.tmp/loop-same-cli-model-smoke/`；任务级脚本执行后移除。构建与单测日志位于 `/tmp/sinitek-loop-model-*.log`；最终空白校验通过。未启动真实模型进程，未重载用户的 Extension Host；使用更新后的扩展并重载后生效，受影响旧任务应选择“使用新配置的主子模型”重新绑定。历史任务及用户配置没有自动改写。
