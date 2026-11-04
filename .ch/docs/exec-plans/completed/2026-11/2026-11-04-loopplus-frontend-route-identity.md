# Loop+ 同 CLI 前端路由不可用修复

- 日期：2026-11-04
- 状态：completed
- 负责人：Codex

## 背景与目标

本机最近两条 Loop+ 拆分任务已保存前端模型，其中一条还保存了前端档案，但均未保存同 CLI 的 `cli` 字段。前端角色解析未沿用主 CLI，直接返回「子-前端配置不可用」，前端执行会话未创建。运行时命名角色绑定也只在跨 CLI 时保留身份。

目标是修复同 CLI 身份传递并兼容已有快照，保留前端独立模型和档案，不以主模型或后端模型替代前端编码。

## 范围与非目标

- 范围：前端执行路由、运行时命名角色身份、相关单元及调度集成测试、设计/功能清单/本体规则。
- 非目标：不修改正在运行的后端任务、真实任务记录、用户配置或凭据；不发布、安装、重启扩展，不启动收费模型请求。
- 保留工作区已有及并发变更，不修改模型发现功能。

## 验收标准

- 已有前端模型或档案但缺少 CLI 的快照，可按任务主 CLI 解析，独立档案优先，仅同 CLI 缺档案时沿用任务原档案。
- 同 CLI 的前端/全栈命名角色身份经过运行时绑定不丢失。
- 缺少前端路由、仅思考档、非法 CLI、跨 CLI 缺档案仍失败，不回退主/后端模型。
- 前端派发、执行、验收集成测试通过；本机真实失败快照只读验证通过；`npm run build` 通过。

## 影响面与风险

- 代码：`src/subtaskCliRoute.ts`、`src/extensionHost/promptRunRuntime.ts`。
- 测试：`src/test/loop/loopPlusSubtaskMode.test.ts`、`src/test/extensionHost/loopModelRouting.test.ts`。
- 文档：Loop+ 调度设计、功能清单、CLI 运行时本体规则。
- 风险：缺 CLI 不等于缺路由；只允许已有前端模型/档案证明身份时按同 CLI 兼容，不将思考档或主配置单独视为前端配置。
- 回滚：只撤销本计划的路由与绑定补丁，无持久化迁移。

## 验证计划

- 先补回归并确认原实现失败，再修复并执行 `npm run build`。
- 最小测试：`node --test dist/test/loop/loopPlusSubtaskMode.test.js dist/test/extensionHost/loopModelRouting.test.js`。
- 扩展测试：角色绑定、子路由、续跑、Loop+ 调度及运行时集成相关用例。
- 真实验证：只读加载本机失败任务，通过编译后的生产角色解析确认 CLI、前端模型、档案与失败状态；不续跑任务。
- 文档验证：ontology 校验和对应脚本测试、局部空白检查。

## 测试与清单同步

- 新增回归：七种 CLI 的历史前端模型/档案、独立档案优先、提示输入省略 CLI、空白/仅思考档/非法 CLI/跨 CLI 缺档案拒绝，以及两种历史快照的完整派发、执行、验收。
- 加强现有运行时矩阵：断言同 CLI 前端/全栈身份不丢失，派发使用真实 `taskType` 字段，避免错误使用被忽略的 `executionRole` 造成假覆盖。
- 修复前：`npm run build` 通过，最小相关测试 42 项中 18 项失败，确认问题可复现。
- 修复后：`npm run build` 通过，最小相关测试 42/42 通过。
- 扩展测试：`node --test dist/test/loop/loopPlusSubtaskMode.test.js dist/test/loop/subtaskCliRoute.test.js dist/test/loop/continueModelChoice.test.js dist/test/loop/loopTaskStore.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/extensionHost/loopModelRouting.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusOrchestration.test.js`：206/206 通过，无跳过。
- 本机真实验证：Node 只读枚举本工作区任务存储，把两条前端失败快照交给 `dist/subtaskCliRoute.resolveLoopPlusRoleExecution`，并用 `dist/config/configPaths.getConfigFilePath` 检查档案文件存在；两条均成功恢复原前端 CLI/模型/档案，无任务数据写入或模型调用。
- 文档验证：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过；`git diff --check` 通过。
- 功能清单、调度设计、ontology 规则和现有踩坑历史已同步；复用既有事实来源，不重复写热区记忆或 `ROLLING_SUMMARY.md`。
- 浏览器验证：不改 Webview UI，无需 Playwright。

## 决策与当前进展

- 代码位置先由 CodeGraph 查询定位，再直接核对当前文件；索引存在漂移，不以旧行号推断事实。
- 本机任务证据已确认前端模型存在，问题是身份兼容与传递，不是模型名配置错误。
- 修复已完成并验证。没有覆盖或回滚工作区其它会话的配置/模型发现改动，也没有创建分支或提交。
- 未验证收费模型服务调用、安装后的扩展宿主热加载；不重启或重派当前真实任务，以免打断其它执行。使用更新后的扩展后可继续原任务，不必修改正确的模型配置。
