# 核心链路性能日志

- 日期：2026-11-20
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

Vibe、经典 Loop、Loop+ 和产研部包含多段 CLI 调度、配置等待、容量准入、执行和清理流程，现有日志难以定位性能耗时。新增独立阶段计时日志，供本机后续排查。

## 范围与非目标

- 覆盖调用、配置等待、runner 派发/执行、主决策、子任务批次/准入/执行/清理、部门组织启动/继续和路由校验。
- 写入 `~/.sinitek_cli/logs/sinitek-cli.performance.YYYY-MM-DD.log`，复用分段轮转及 `historyRetentionDays` 自动清理，不受 debug 日志开关影响。
- 只记录 Trace ID、执行模式、CLI、角色、阶段、结果和耗时；不记录提示词、模型输出、路径、会话/任务标识、配置或错误详情。
- 不新增设置、定时器，不改变任务调度、权限或对话行为，不记录逐流事件。

## 验收标准

- [x] Vibe、经典 Loop、Loop+ 和产研部的核心阶段可关联和计时，正常、失败、停止及拒绝结果可区分。
- [x] 未启动 runner 的派发不记录为成功；未配置容量准入时不产生虚假的准入拒绝。
- [x] 日志独立落盘、分段轮转并遵循当前历史保留天数，日志写入异常不影响任务。
- [x] 产品能力、功能清单、运行手册、CLI 运行事实来源及相关 ontology 已同步。

## 影响面

- 代码：`src/performanceLog.ts`、`src/logger.ts`、`src/extension.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/sessionMessageActions.ts`、`src/sessionMessageHandlers.ts`。
- 测试：性能日志保留、Loop+ attempt 生命周期与准入、消息派发模式。
- 文档：功能清单、产品能力、CLI 运行事实来源、本地开发手册和 `cli-plugin-runtime` ontology。

## 风险与缓解

- 日志 I/O 不可用可能干扰实际执行：所有性能日志写入异常均被隔离。
- 日志误收集提示词等敏感内容：日志结构采用字段白名单，不接受错误详情或执行内容。
- 准入阶段误报拒绝：仅在存在容量准入端口时记录该阶段。

## 验证与测试

- `npm run build`：通过。
- `npm run test:core`：357/357 通过。
- `node --test dist/test/core/performanceLog.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusRuntimeAdmission.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/departmentruntimeintegration.test.js dist/test/extensionHost/departmentruntimecomposition.test.js dist/test/loop/loopParallel.test.js dist/test/session/sessionMessageActions.test.js`：477/477 通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 domains / 27 concepts / 24 relations / 189 rules / 4 workflows。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- `git diff --check`：通过。
- 未运行真实 CLI 或 Extension Development Host；本次自动化验证不代表真实模型耗时表现。
- 失败分类：无失败。

## 决策记录

- 2026-11-20：性能日志采用独立前缀与独立 Trace ID，复用既有日志目录、分段轮转及保留清理。
- 2026-11-20：未启动执行映射为 `stopped` 或 `threw`；没有准入机制时不记录准入阶段。
- 2026-11-20：在本地隔离工作树实施，避免覆盖共享工作区中的并行 UI 改动。

## 当前结论

实现、文档同步和自动化验证已完成。未验证真实 CLI 与 VS Code Extension Development Host；需在后续性能排查中结合本机日志观察实际阶段耗时。

## 任务列表

- [x] 核对日志目录、历史清理和核心链路事实来源。
- [x] 实现性能计时、日志落盘及 Vibe / Loop / Loop+ / 产研部埋点。
- [x] 补充隐私、保留清理、准入和生命周期回归测试。
- [x] 同步产品文档、运行手册和 ontology。
- [x] 完成构建、自动化回归与 ontology 校验。
