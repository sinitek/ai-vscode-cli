# Loop+ 子任务运行所有权与完成状态修复

- 日期：2026-11-13
- 类型：bugfix
- 关联计划：`../../active/2026-11-12-bugfix-codex-release-state.md`、`../../active/2026-11-12-bugfix-codex-runtime-fingerprint.md`、`../../active/2026-11-12-bugfix-codex-unload-policy.md`；保留既有写锁交接安全约束，不覆盖其验收记录或改变其状态。
- 状态：completed（源码修复与本机验证；未发布、未安装）
- 负责人：Codex

## 背景与目标

1.9.2 用户报告 Loop+ 子任务 779、781 中途显示完成但未完成、标签未自动关闭。只读核对本机运行记录：两次原始调用均为 error / RUNNER_DISPOSED，同会话的新“继续”调用分别早于旧调用失败 18ms、7ms；779 原始协议无最终答复或正常完成。781 提供第二组复现证据。上述本机私有路径、业务提示词不写入仓库。

目标：定位假完成与运行器替换的共同原因，修复生命周期并保留 1.9.2 跨连接写锁交接。

## 范围与非目标

- 范围：状态展示、交互运行所有权、Codex 运行器复用、Loop+ 正常完成关闭及相应回归。
- 非目标：发布、安装、重启正在运行的扩展；修改真实任务状态或业务产物；回滚写锁保护。

## 验收标准

- 活跃子任务不会因错误状态展示被当作完成；正常完成后自动关闭。
- 旧调用的收尾不会覆盖或删除新调用；异常不冒充成功。
- 同会话交接仍等待真实释放，不破坏并行的其它会话。
- 相关回归与 `npm run build` 通过；记录真实验证边界。

## 影响面与风险

- 代码：`src/interactive/`、`src/extensionHost/`、必要的 Webview 状态代码与 `src/test/`。
- 文档：运行时设计、功能清单、ontology、必要的复发陷阱记录。
- 风险：把失败强行关闭会吞掉证据；不采取此方案。避免向真实会话发请求干扰运行。

## 验证计划与清单同步

- 先构造最小可复现回归，再 `npm run build` 和相关 `node --test dist/test/...`。
- 扩展验证覆盖运行器释放、写锁交接和子任务关闭；真实会话仅只读核验协议与日志。
- 完成时同步 FEATURE_INVENTORY、对应运行时文档与 ontology，执行 ontology validate。
- 单元自测结果、失败分流：待记录。

## 根因与实施

- 原生记录中两次原始调用均没有最终答复或正常完成事件；存储是 blocked/error，不是 completed。失败保留 Tab 符合当前策略，正常完成才自动关闭，未改为失败也关 Tab。
- Webview 从历史消息恢复摘要时越过了最新用户轮次，可展示前次“任务已完成”；新用户消息原先只清成功保护，不清旧摘要。现限定恢复边界并立即清除旧摘要，宿主完整状态发布后立即恢复真实活跃的 Loop 调用。
- 多个子任务 Tab 绑定同一 session；手动继续不经过调度器 session lease，宿主只检查目标 Tab。新的临时 cwd 令 manager 的复用检查失败并 dispose 活跃旧 runner。现于异步准备之后、运行登记/runner 获取之前拒绝同 Tab 或同 CLI + session 的重复调用，不影响其它会话；停止后允许重试。
- 补充 runId 收尾保护及 Codex 迟到 thread/taskList 回调门禁；外层迟到错误不覆盖目标 Tab 正在运行的替代调用。
- 保留配置指纹、cwd 隔离、真实 thread/closed/进程退出交接门禁，不回滚 1.9.2 安全修复。现有证据不能把最初 UI 状态丢失精确归因于某条 Windows 专用提交，也不能把手动继续引起的释放反推为最初误报原因。
- macOS 真实验证中另修复验证脚本的 `/var` 与 `/private/var` 临时根别名误报：创建根目录后 realpath，不放宽安全归属检查。报告不再硬编码当前 macOS 本机尚未覆盖。

## 验证结果

- `npm run build`：最终通过，日志 `/tmp/loop779-final-build.log`。
- 最小回归：`node --test dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/webview/tabRunStatus.test.js`，56/56。将相关生产模块在内存中替换为 HEAD 原实现运行同一用例，50/56，明确复现 6 项失败；不改动工作树或真实会话。日志 `/tmp/loop779-focused-tests.log`、`/tmp/loop779-baseline-regressions.log`。
- 最终关联回归：`node --test dist/test/extensionHost/prompt*.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/loop/loopSubtaskSession.test.js dist/test/loop/loopSubtaskAutoCompact.test.js dist/test/session/conversationTabRunningFlow.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/webview/tabRunStatus.test.js dist/test/webview/conversationTabClose.test.js dist/test/core/codexRunnerUnloadAcceptance.test.js`，365/365、无跳过。覆盖正常完成自动关 Tab、失败保留、显式中止与替代调用。日志 `/tmp/loop779-final-tests-confirmed.log`。
- 扩大到 Codex/manager/交接/生命周期和全部 Webview 单测：1065 项，1062 通过、3 失败。失败已用 HEAD 生产模块复现，属于历史/环境问题：能力探测夹具的空命令断言在本机返回已解析版本；Loop+ Webview 夹具两项缺失 retainChatBubbleEntries。未修复范围外问题；日志 `/tmp/loop779-regressions.log`、`/tmp/loop779-baseline-existing-failures.log`。
- 原生 macOS arm64、Codex 0.167.0：`CODEX_COMMAND="$(command -v codex)" node scripts/verify_codex_runner_unload.js --live --report /tmp/loop779-macos-runner-unload-final.json` 通过。原 thread 恢复、另一 thread 保留、真实 thread/closed 后交接 26ms、4 次隔离本机模拟请求；进程退出、stdio 关闭和临时目录删除均确认。该验证不调用真实模型、不连接用户会话。
- 真实验证失败也保留记录：默认命令在本机解析为另一套 0.145.0，未知卸载能力交接未通过；改用显式 0.167.0 后暴露脚本 canonical 根误报，修复验证脚本后通过。两次失败的隔离资源均已确认清理；未修改用户 CLI 配置，不能据此认定事故使用了哪套二进制。
- Headless Chromium 157：执行生产摘要恢复/活跃恢复函数的独立逻辑烟测通过，零浏览器/控制台/网络错误，截图已检查 `/tmp/loop779-chromium-state-smoke.png`；不是完整 VS Code Webview 端到端验收。
- Ontology `--validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`，9/9。`git diff --check` 通过。全局 `npm run validate:whitespace` 报未修改的 AGENTS.md:8 历史行尾空白，不扩大修复。

## 文档与验收边界

- 已同步运行时设计、FEATURE_INVENTORY、ontology、PITFALLS 与事件记忆；未写入 ROLLING_SUMMARY，也未保存真实业务提示词、客户数据或环境凭据。
- 本次交付为源码修复、自动回归与隔离本机验证。未发布/安装/重载扩展，未改动 779/781 的真实任务状态、运行会话或业务产物。
- 本轮未在原生 Windows/Linux 复验，未执行安装后真实 VS Code 多窗口/Loop+ 端到端验收；既有平台验证记录及其待验收项不被本计划替代。
