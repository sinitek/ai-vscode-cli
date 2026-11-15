# Loop/Loop+ 子任务派发立即显示运行中

- 日期：2026-11-15
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：无；保留工作区已有修改。

## 目标与范围

Loop/Loop+ 子任务标签创建时立即发送运行状态，不等待会话、配置及 CLI 准备；共用启动间隔从三秒缩短为一秒。启动准备取消或失败时清除提前发送的运行状态。沿用现有调度准入、执行时间和终态语义。

## 验收与影响面

- 共用标签入口在页面刷新前发送 start，覆盖新会话和续接会话。
- 首次启动无延时，后续启动最小间隔为 1000ms。
- 尚未进入 CLI 的失败、取消清除状态；已启动的调用沿用运行时收尾，不覆盖后台压缩。
- 涉及 sessionTabs、经典 Loop 编排、Loop+ adapter 及 extension 接线；同步规格、设计和 ontology。

## 风险与验证

提前展示运行状态可能在准备异常后残留；以未实际启动的收尾回调和定向回归覆盖。保留工作区既有修改，局部回滚本次差异即可，不改用户数据或依赖。

执行 npm run build，再运行标签、子任务生命周期、编排及 adapter 相关单测；用现有 Webview 状态处理器确认提前 start 和终态切换。完成 ontology 校验与相关文件空白检查。未覆盖边界与失败分类在收尾记录。

Tasklist:
- [completed] 定位共用派发入口与启动间隔
- [completed] 修改状态时序及未启动收尾并补充回归
- [completed] 完成构建验证、事实来源同步与归档


## 验证结果与结论

- `npm run build`：通过。首次新增测试夹具缺少必填 `sessionIdByCli`，分类为测试夹具问题，补齐后构建通过。
- `node --test --test-reporter=spec dist/test/session/sessionTabCliSwitch.test.js dist/test/loop/loopSubtaskLifecycle.test.js dist/test/extensionHost/loopWaitWatchdog.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/webview/tabRunStatus.test.js`：221 项通过，无失败或跳过；日志 `.tmp/loop-subtask-start-tests.log`。
- 提交前按差异块筛选本任务修改，并将完整暂存快照导出到系统临时目录独立验证：`npm run build`、上述同一单测命令（219 项通过，无失败或跳过）及 ontology 校验均通过；此快照未包含工作区其它任务的修改。
- 按 chromium-playwright-smoke skill 使用生产 `getWebviewHtml` 页面与模拟宿主消息，本机 headless Chromium 验证 start 先于标签刷新：主标签保持空闲，经典 Loop 与 Loop+ 子标签首次显示即运行；准备失败/取消后两个标签均清除运行，只有失败项显示错误。两场景均通过，浏览器、HTTP 和网络错误为空；已检查截图。结果位于 `.tmp/loop-subtask-start-smoke/start/result.json` 与 `.tmp/loop-subtask-start-smoke/terminal/result.json`。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；ontology 单测 9 项通过。
- 本次相关文件 `node scripts/check_trailing_whitespace.js <files>` 与 `git diff --check`：通过。
- 已同步功能清单、能力规格、Loop+ 调度设计及 ontology；例行修复无需新增热区记忆或 runbook。
- 未运行完整 VS Code Extension Development Host 或真实 CLI 付费调用：本次只调整派发时的 Webview 状态通知及本地共用启动间隔，由生产页面和宿主边界回归覆盖。源码构建成功不表示已安装扩展已重新加载。

本次完成标签创建时的运行反馈和 1 秒启动间隔，并保留工作区已有修改。
