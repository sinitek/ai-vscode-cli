# Loop+ 完成结果丢失导致子任务未关页

- 日期：2026-11-13
- 类型：bugfix
- 关联计划：无；保留工作区已有部门模式改动
- 状态：completed
- 负责人：Codex

## 背景与目标

本机消息记录证明目标子任务已有 Codex final answer 和“执行结束，等待主任务验收”，但调度快照记录 outcome=failed、detail=failed，成功 TaskRunRecord 在共享 tasks.json 中缺失，Tab 因此保留。当前适配器在 runPrompt 结束后重读跨窗口共享的历史文件决定本次结果，文件覆盖或读取竞争会丢失本次成功事实。

目标是在本次调用范围内直接捕获宿主发布的真实完成记录，使自动关页、主模型结果读取不依赖共享历史文件的即时可见性。继续校验调用身份、轮次、提示词和时间边界；失败、停止、缺失记录保持原语义。

## 范围与非目标

- 修改宿主完成记录发布、Loop+ 调用收口与相关回归；同步功能清单、设计与 ontology。
- 不根据最终答复文字推断成功，不改验收门槛；不修改用户任务和会话数据。
- 不迁移共享历史存储，不在此修复跨进程历史文件完整性的全部问题。

## 验收标准

- 本次真实成功记录被共享历史覆盖或历史读取失败时，仍正确返回 completed 并关页。
- 主模型同样使用本次完成记录读取决策；失败、停止、取消、旧结果及错误身份不误判成功。
- 调用结束或异常后释放订阅，无长期累积。
- 本次模块类型检查、相关回归与 ontology 校验通过；执行 npm run build，范围外失败须记录证据。

## 影响面与风险

代码：src/extension.ts、src/extensionHost/loopPlusRuntimeAdapter.ts、对应运行时夹具和测试。文档：Loop 子任务复用设计、FEATURE_INVENTORY、cli-plugin-runtime ontology。

风险为串用并行调用结果；沿用已有完整匹配条件并补并发、失败与清理测试。未注入完成订阅的既有适配器保持历史读取兼容。

## 验证计划

- 先添加模拟共享历史丢失的回归并确认修复前失败。
- npm run build。
- node --test dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusRuntimeAdmission.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/loop/loopSubtaskLifecycle.test.js。
- 本机运行记录只读核对；隔离复现共享历史覆盖与当前适配器收口。
- ontology --validate 与其单元测试；git diff --check。

## 任务列表

- [completed] 定位原任务和完成结果误判链路
- [completed] 捕获本次宿主完成记录并补回归
- [completed] 验证与文档同步

## 实现与验证结果

- `appendTaskRun` 在持久化前通过扩展宿主事件发布真实终态，Loop+ 在调用期间直接捕获符合已有完整匹配条件的记录；主、子路径共用调用包装，finally 释放订阅。未提供事件端口时兼容原历史读取。
- 修复前新增 5 项相关用例中 3 项失败：主任务降级 needs-review、成功子任务被记为 failed、停止状态被记为 failed；修复后均通过。
- `node --test dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusRuntimeAdmission.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/loop/loopSubtaskLifecycle.test.js`：90 项通过，0 失败、0 跳过。覆盖成功/失败/停止/缺记录、并发隔离、共享历史读取异常、CLI 收口异常、订阅清理与无事件端口兼容。
- 最小类型检查通过：`./node_modules/.bin/tsc --noEmit --target ES2020 --module commonjs --lib ES2020 --strict --noImplicitReturns --noFallthroughCasesInSwitch --forceConsistentCasingInFileNames src/config/yauzl.d.ts src/test/extensionHost/loopPlusRuntimeIntegration.test.ts src/test/extensionHost/loopPlusRuntimeAdmission.test.ts src/test/session/sessionTabCliSwitch.test.ts src/test/loop/loopSubtaskLifecycle.test.ts`。首次直接文件检查漏带仓库已有 yauzl 声明，补入声明后通过，无依赖或源码变更。
- `npm run build`：未通过，归类为工作区并行部门模式改动的范围外失败。修复实现前已存在 InteractiveMode 新增 department 与上下文压缩入参不兼容、departmentGroupChatProjection 空值类型错误；最后一轮仍有 contextCompactionRunner.ts:983、promptInteractiveRuntime.ts:288 的模式类型错误，以及新出现的 departmentorchestration.ts:113/117/119 的租约 release 类型错误、loopGroupChatPanelCoordinator.ts:903 的 Webview 转换错误。本次修改文件中的修复代码没有编译诊断；测试使用 tsc 已正常生成的相关 dist 文件执行。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过；`git diff --check` 通过。
- 本机只读核对结果：`codexFinalAnswer=true`、成功完成系统消息存在、共享历史匹配记录数 0、对应调度 outcome=failed。未修改该任务、会话、Tab 或历史文件。
- 已同步 FEATURE_INVENTORY、Loop 子任务会话复用设计及现有运行所有权 ontology 规则；无需额外热区、EVENT_MEMORY 或新 runbook，稳定事实直接保留在设计文档。

## 提交前的独立验证

- 用户要求只提交本任务。按 HEAD 逐段提取 4 个代码/测试文件、3 个事实来源文档和本计划，排除部门模式、执行准入及其原测试断言变更；使用独立暂存索引和临时源码目录验证，原工作区其它修改保留。
- 原未提交准入逻辑使用的 onStarted 回调在本修复共用包装中改为可选，已提交基线的子任务调用可直接使用同一完成捕获路径，不引入准入接口或部门依赖。
- 独立快照 `npm run build` 通过。
- 独立快照 `node --test dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/loop/loopSubtaskLifecycle.test.js`：66 项通过，0 失败、0 跳过。原工作区 90 项记录包含其它任务尚未提交的 24 项准入测试，本提交未包含它们。
- 独立快照 ontology 校验通过；ontology 的 9 项单元测试通过；暂存 diff 空白检查通过。

## 验证边界

未发布、安装或重新加载扩展，未做真实 VS Code 图形界面的关页验证；没有 UI 代码变化，无需 Chromium 页面冒烟。本次确保活跃调用直接接收真实完成记录，不解决跨进程共享历史文件完整保留问题，也不自动修复已有 failed 快照。

## 当前结论

已修复共享历史缺失导致活跃 Loop+ 调用误判结果、成功子任务未关页的问题，并完成相关回归、最小类型检查与文档维护。多窗口覆盖的具体系统调用时序无历史日志，不能进一步断言；本任务独立快照的完整构建及相关测试已通过；已安装扩展实机验证仍受上述边界限制。
