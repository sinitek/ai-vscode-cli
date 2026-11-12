# Loop / Loop+ 主模型提问终止修复

- 日期：2026-11-12
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

用户反馈向主模型提问后点击终止，问答仍继续执行。取消状态已传到 `runPromptNow`，但没有继续传到异步运行时准备；准备期间尚未注册 runner，停止回调可能找不到可停止的执行。Codex `runStreamed` 在 `ensureReady` 之后才捕获取消代次，也会漏掉立即停止。

## 范围与非目标

修复提问取消信号穿透启动准备、OpenCode 子代理准备完成后的启动守卫及 Codex 立即取消竞态；停止优先于已保存的部分回答。补回归测试并同步功能清单和 ontology。不改变调度优先级、不终止排队问题所属主任务、不调整 UI 或配置。不修改工作区原有未提交改动，不创建分支或 worktree。

## 验收标准

- 准备期间取消后不再启动模型回答或 CLI 子进程。
- 已开始回答仍沿用原 runner 停止逻辑；取消后续队列不影响主任务和其他 Tab。
- 取消后部分回答不被判定为正常完成。
- 最小相关测试与 `npm run build` 通过。

## 影响面与风险

- 代码：提问会话、扩展运行时参数、交互运行时、OpenCode 共用模板、Codex runner。
- 文档：功能清单、CLI 运行时 ontology。
- 风险：共享启动守卫影响普通对话；参数可选，未传取消回调保持原行为。OpenCode 准备后中止需释放准备资源。
- 回滚：仅回退本计划列出的补丁，保留既有工作区修改。

## 验证计划

- 单测：`loopMainQuestion`、`loopMainQuestionQueue`、`loopGroupChatCoordinator`、`promptSessionHealth`、`promptInteractiveRuntime`、`openCodePromptRunTemplate`、`codexRunnerLifecycle`。
- 构建：`npm run build`；修改后从最小相关测试扩大到 Loop 与运行时相关测试。
- 真实本机：使用受控本地 app-server 子进程验证 Codex 停止，不访问真实模型或用户会话。不改 UI，无需浏览器布局测试。

## 任务列表

- [x] 核对当前代码、ontology 与召回入口。
- [x] 补回归用例并验证失败原因。
- [x] 修复取消链路并运行构建、相关测试。
- [x] 同步文档、校验 ontology、归档计划。

## 测试与清单同步

- 单元自测结果：`npm run build` 通过；最小相关 7 个测试文件合计 181 项全部通过。
- 收尾并行变更提醒：本任务最后一次 `npm run build` 复跑返回 2；期间其他工作新增的 `src/test/config/zcodemodellist.test.ts:59` 报 TS2339（`never.error`），`:145` 报 TS2322（模型夹具缺少 `hidden`）。该文件不在本任务修改范围，未修复；此前同一修复代码的构建和 181 项测试均已通过。当前工作区整体构建需由该并行任务修复后重跑，不能把此前成功解释为最终工作区全绿。
- 提交前隔离验证：按代码块暂存本任务改动，以 `git checkout-index --all --prefix=<临时目录>/` 导出待提交快照，仅软链接现有 `node_modules`，未带入其他任务的未暂存代码。在该隔离快照运行 `npm run build`、上述 7 个相关测试文件和 ontology 校验，构建通过、181 项全部通过、ontology 校验通过；确认本任务提交自身不依赖并行修改。
- 最小相关命令：`node --test dist/test/loop/loopMainQuestion.test.js dist/test/loop/loopMainQuestionQueue.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/extensionHost/promptSessionHealth.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/openCodePromptRunTemplate.test.js dist/test/interactive/codexRunnerLifecycle.test.js`。
- 扩展验证命令：`node --test dist/test/loop/*.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptRuntimeCoreCoverage.test.js dist/test/extensionHost/loopPlusEntryRouting.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/interactive/codexRunnerReuse.test.js dist/test/interactive/codexRunnerRuntime.test.js dist/test/interactive/codexRunnerSubagent.test.js`。595 项中 591 通过、4 项范围外失败。
- 失败处理记录：修复前 6 项新增测试复现实现缺陷。首次共享模板守卫还使用 `isRunActive`，扩展验证发现并行运行时直到进程生成后才注册，导致 2 项原有并行测试失败；移除不适合准备阶段的活跃判断，只使用明确取消信号，恢复原有断言和生命周期后全部相关测试通过。
- 范围外失败：`loopPlusGroupChatPanel.test.js` 的队列展示、暂停验收、验收结果、已中断子任务展示共 4 项旧 UI 断言失败（`current` / `reviewed` 计数及“验收结果”文本）。单独执行同一测试，并在退出时审计 `require.cache` 与 `git diff --name-only HEAD -- src`，结果 `loadedSourceCount=73, changedSourcesLoaded=[]`：该测试及全部加载代码均无本次变更，不扩大修复范围。
- 本机进程验证：用 `node` 临时脚本、隔离的 `CODEX_HOME_DIR`、真实本地 app-server 子进程运行生产 `CodexInteractiveRunner`，等待 `turn/start` 后调用 `stopAndRebuild()`。输出 `PASS: real local app-server subprocess received turn/interrupt; runner ended with AbortError.`；RPC 顺序为 `initialize → initialized → thread/resume → turn/start → turn/interrupt`。未连接真实模型，临时文件已清理。
- ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 的 9 项通过。
- 功能清单与 ontology 已明确准备阶段停止、资源释放、部分回答停止优先。
- 记忆评估：将可复用故障原因沉淀到 `.ch/docs/runbooks/PITFALLS.md`，未自动写入滚动摘要或占位热区。
- 未覆盖：未在 VS Code Extension Development Host 中点击真实提问弹窗，未连接用户真实 CLI 会话或在线模型；未修改 Webview，因此不跑布局浏览器验证。后续可在扩展宿主中分别检查 Loop / Loop+ 等待阶段和回答阶段终止。

## 当前结论

已将取消回调从 `runPromptNow` 传到具体运行时，在异步准备完成后阻止迟到启动并释放 OpenCode 准备资源；Codex 在首个 `await` 前捕获取消代次；回答归类以停止为先。原有排队取消不停止主任务、后续问题清空和跨 Tab 隔离保持不变。本次补丁构建、181 项相关测试、ontology 与真实本地子进程中断验证通过；4 项无关 UI 断言失败已用依赖审计定位并记录。最终工作区重建被并行新增的 ZCode 测试类型错误阻断，须由对应任务修复后再构建。
