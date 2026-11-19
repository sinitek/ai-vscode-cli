# Grok Loop+ 会话稳定执行目录修复

- 日期：2026-11-19
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与根因

产研部 Grok 员工首轮成功，续跑时 Loop+ 为新 attempt 分配了不同的临时 cwd。Grok Build 1.0.62 的 ACP `session/load` 在新 cwd 下找不到原会话；普通 runner 回退到 `session/new`，部门 Owner 拒绝用新会话覆盖原绑定，报 `department-interactive-session-conflict`。这不是两个子任务争用同一会话。冲突校验是通用的；cwd 导致的触发链路只在本次 Grok 场景复现。

## 修复与验收

- Loop+ 给首次 Grok 会话分配受控目录标识并随 `executionSession` 持久化。同子任务重试、跨子任务修补及多跳续接复用该目录；独立会话目录不同。
- 每轮重建工作区链接，按原执行根身份校验拆链；部门路径先等待原 runner 的清理观察再拆链和归还容量。未知内容保留，目录不递归删除。
- 已绑定的 Grok 会话仅允许严格恢复原会话 ID，不静默新建；Owner 仍是部门绑定写入方。普通 Vibe 的回退行为和其他 CLI 路径不变。
- 旧绑定若缺少原目录标识则拒绝续接，保留原会话和记录；没有自动迁移旧任务，也没有重放用户任务。

## 验证结果

- 隔离工作树与主工作区 `npm run build` 均通过；隔离定向回归 162/162，主工作区集成后扩展回归 323/323。覆盖 Grok runner/策略、会话绑定、执行根、部门互动、Loop+ 准入和 prompt/runtime 集成。
- 主工作区命令：`node --test dist/test/interactive/grokRunner.test.js dist/test/extensionHost/interactiveTurnGrok.test.js dist/test/loop/loopSubtaskExecutionRoot.test.js dist/test/loop/loopSubtaskSession.test.js dist/test/extensionHost/departmentinteractiveruntime.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusRuntimeAdmission.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/departmentruntimeintegration.test.js`。
- 本机 Grok 1.0.62：通过 `node` 调用构建后的 `GrokInteractiveRunner`，对临时 `GROK_HOME` 和隔离执行根做纯 ACP 握手。首次创建成功，关闭进程并刷新链接后在同 cwd 恢复原 ID；异 cwd 严格恢复返回 `Path not found.`。测试没有发送模型 prompt，未重放原任务或运行已安装扩展端到端。Windows 仅覆盖现有隔离根模拟测试。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与 Ontology 9 项测试通过。已同步部门设计、CLI 运行时参考、功能清单和排障手册。
