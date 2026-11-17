# Vibe 澄清被误作最终答复修复

- 日期：2026-11-17
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

用户反馈“‘撤销验收’希望如何处理？”及两个无编号选项直接出现在最终答复，没有弹出人机交互。当前自然语言兜底依赖原始输入明确要求询问需求，问题列表通常至少两题，且仅支持特定选项格式。

目标是使明确向用户请求决策的单题澄清进入现有表单，即使原始输入未要求先提问；保留选项全文，提交后继续原会话。

## 范围与非目标

- 范围：共享自然语言澄清解析、Vibe 交互运行时回归、现有提示约定与事实文档。
- 不改技术栈、CLI 协议、Webview 组件、Loop/Loop+ 协议或其它在途修改；不发布扩展。

## 验收标准

- 用户原例可解析成一题单选，两个选项完整保留。
- 支持无编号、项目符号、数字和字母选项；单题和已有多题澄清均可处理。
- 普通结果、反问、引用/代码示例和已完成说明不误弹窗。
- Codex 提交后续接同一会话；拒绝、开关关闭与 Loop 边界继续保持。
- 相关回归、标准构建、本体校验通过；完成最小本机真实 CLI 验证并如实记录边界。

## 影响面与风险

- `src/humanInteraction.ts`、`src/promptRuntime.ts` 及相关 core/extensionHost/interactive 测试。
- 产品能力清单、人工交互排障文档、本体。
- 风险：自然语言误判。通过整段结构、明确决策语气、引用/代码与完成结果反例约束检测。
- 当前工作区有其他未提交改动，所有编辑均保留式增量；不复用旧构建验证本次源码。

## 验证计划

- `npm run build`
- `node --test dist/test/core/humanInteraction.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js`
- 按影响补充原生 Codex 能力与表单既有测试；真实 CLI 使用隔离配置与本机模拟响应，不调用付费模型。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`

## 测试与清单同步

- `npm run build`：最终通过。首次新增夹具误用不存在的 `taskRole=orchestrator`，已移除该冗余字段；属于夹具类型错误，未改变生产角色契约。
- 最终相关回归命令：`node --test dist/test/core/humanInteraction.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js dist/test/interactive/codexRunnerRuntime.test.js dist/test/interactive/codexRunnerLifecycle.test.js dist/test/webview/multiAgentSettingWebview.test.js`；180/180 通过，无失败、取消、跳过或 TODO，耗时约 37.6 秒。日志：`/tmp/sinitek-human-input-tests-final-20261117.log`。
- 首轮 112 项中 111 通过，新增运行时断言误把 getOrCreate 次数当成进程创建次数；夹具每轮调用一次但返回同一 runner，已改成与 attempts 一致。属于测试断言错误；最终重跑覆盖全部相关范围。
- 基线复现：从 `git show HEAD:src/humanInteraction.ts` 取原实现并用仓库 TypeScript 转译，用户原例返回 `null`；当前构建返回 `type=radio`、两个选项。
- 最小真实 CLI：`node /tmp/sinitek-verify-human-input-20261117.cjs` 通过。macOS / Node v24.22.2 / PATH Codex 0.167.2；真实 app-server、隔离 HOME/工作区、只访问本机模拟 Responses 服务。真实输出原例后解析成一题双选项，模拟提交首选项并继续原 thread，第二轮最终回复到达；确认共两次本机模型请求、原 thread 未变、进程/stdio/临时目录全部清理。报告：`/tmp/sinitek-human-input-live-20261117.json`，脚本和报告为本地临时证据，不入仓。
- 本体：`search_ontology.py --validate` 通过；ontology Python 单测 9/9 通过。
- 静态检查：`git diff --check` 通过；收尾对本次文件执行仓库 whitespace 脚本。
- 已同步功能总表、能力分册、运行时设计、PITFALLS 及 `plugin.rule.vibe_clarification_final_answer_fallback` 本体规则。长期记忆无需再复制同一结论，稳定根因与规避已写入 runbook。

## 验证边界

未运行真实付费模型、已安装扩展的图形宿主弹窗、Windows/Linux 原生进程或全仓单测；真实 CLI 验证证明 macOS CLI 输出—共享解析—同会话续接链路，不等价于模型永远遵守指令。前端代码未改，复用现有表单并通过其既有脚本测试。本次未打包、安装或发布扩展。其它在途源码仍有变化，最终结果只覆盖上述本次范围与实际执行时的构建。

## 任务列表

Tasklist:
- [completed] 召回规则并定位显式意图、题数和选项格式三处漏判
- [completed] 修复共享解析与补充真实示例及误触发回归
- [completed] 完成运行时验证、事实文档同步和计划归档

## 决策记录

- 2026-11-17：CodeGraph 定位 `buildNaturalLanguageHumanInteractionRequest` 与运行时调用；直接读取确认三个 Vibe 入口共用同一解析器。保留旧显式需求解析兼容，新增受整段结构约束的决策澄清路径，不依赖外部分类服务。
- 2026-11-17：memory-recall focus 为“人机交互 request_user_input elicitation final_answer Codex”，无 anchor；召回只有无关 Loop 计划，实际事实回到产品规格、人工交互 PITFALLS 及当前代码核实。召回输出留在 `/tmp`，未覆盖工作区召回材料。

## 本次 Git 提交范围复核

- 按用户要求仅提交本任务；五个源码/测试文件完整纳入，五份共享文档仅抽取本任务内容，另纳入本计划。未提交 Loop+ 依赖、撤销验收、子任务标签及本体其它规则/格式化改动。
- 从 HEAD 与上述 11 文件候选内容导出独立目录，复用依赖但使用独立 dist；标准 `npm run build` 通过，五组最小相关回归 113/113 通过，无失败/取消/跳过/TODO，本体结构校验通过。此前真实 CLI 与 180 项回归证据仍按上文边界保留，不将两次执行相加。

## 当前结论

本次源码修复完成并通过相关验证。共享 parser 现在能识别用户原例及同类单题决策，现有运行时负责替换问题气泡、等待回答和续接；上文保留图形宿主与真实模型的验证边界。
