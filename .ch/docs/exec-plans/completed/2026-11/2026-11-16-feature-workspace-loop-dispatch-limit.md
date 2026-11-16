# Loop/Loop+ 单次派发上限支持工作区覆盖

- 日期：2026-11-16
- 类型：feature
- 关联计划：无；保留工作区已有 Loop+ 交接修复改动
- 状态：completed
- 负责人：Codex

## 背景与目标

当前派发上限只读写全局设置。工具设置的“工作区”页签增加可选覆盖，工作区优先于全局，未设置时继承全局，最终默认 6，范围 1–20。

## 范围与非目标

复用工作区 JSON、设置消息、面板状态及数值归一化。经典 Loop 提示与解析、Loop+ 派发校验和生产并发容量统一读取生效值。不改调度算法、任务快照和既有运行中任务的容量策略。

## 验收标准

- 工作区值持久化且仅影响对应工作区，重载后保留。
- 全局输入框保持全局值；工作区留空继承，清空删除覆盖。
- 数值向下取整并限制 1–20；非法工作区存储值继承全局。
- 三个生产运行时接线使用同一生效值，切换工作区后读取当前设置。
- 相关单测、构建、浏览器验证与 ontology 校验通过。

## 影响面与风险

涉及 workspaceSettingsStore、modelSettings、设置消息、panelStateBuilder、Webview 与对应测试。已有未提交改动采用局部补丁保留；共享 dist 由其它运行时任务占用，使用唯一临时副本执行 npm run build 和相关测试，不新增依赖或更改框架。

## 验证计划

- 临时副本 npm run build。
- node --test：工作区存储、设置消息、宿主配置/面板、生产接线、Webview 状态与事件。
- headless Chromium：工作区输入、清空继承、全局值展示及宽窄屏。
- ontology --validate 与 ontology 单测、git diff --check。

## 测试与清单同步

- 新增工作区值归一化/持久化/隔离、覆盖优先级、清空继承及界面消息回归。
- 同步 FEATURE_INVENTORY、设置消息设计、运行时参考与 ontology。
- 验证结果见下方；无需将单次任务写入热区记忆。

## 任务列表

Tasklist:
- [completed] 确认配置入口、保存方式与优先级逻辑
- [completed] 实现工作区配置并补充回归验证
- [completed] 更新相关文档并完成构建检查

## 当前结论

已完成。全局和工作区设置分别保存，经典 Loop 与 Loop+ 的生产入口统一按工作区 → 全局 → 默认 6 读取，清空工作区输入恢复继承。


## 最终验证（2026-11-16）

- 在唯一临时副本 `/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-workspace-loop-limit-05ucelnk` 执行 `npm run build`，通过；未清理或覆盖原工作区共享 `dist/`。验证后逐文件比较 `src/**/*.ts`，与原工作区完全一致。
- 最小相关单测：`node --test dist/test/core/workspaceSettingsStore.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/session/sessionMessageActions.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/extensionHost/workspaceHarnessInitialization.test.js dist/test/extensionHost/promptExecutionShared.test.js dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`：358/358 通过。
- 相关编排回归：`node --test dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js`：171/171 通过。两组无失败或跳过，日志保留在 `.tmp/workspace-loop-dispatch-limit/workspace-dispatch-tests.log` 与 `workspace-dispatch-loop-tests.log`。
- Chromium 真实渲染生产 Webview HTML，使用模拟 VS Code 消息桥：验证工作区填写、全局输入独立、修改全局不覆盖工作区、清空继承、0/99 钳制、切换工作区清空旧值；1280×900 与 390×844 无横向溢出或控件重叠。浏览器行为记录：`.tmp/workspace-loop-dispatch-limit/browser-result.json`。
- 使用 `chromium-playwright-smoke` runner 验证上述两个视口，均 passed，浏览器/网络错误均为空。结果为 `.tmp/workspace-loop-dispatch-limit/smoke-desktop/result.json` 与 `smoke-narrow/result.json`，附截图。
- runner 首次未发现已安装于 `/tmp` 的 Playwright（macOS 的系统临时目录不同），属于验证工具环境发现问题；显式 `PLAYWRIGHT_MODULE_PATH=/tmp/zq-playwright-smoke/node_modules/playwright` 后两视口均通过，未修改项目依赖。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过；`git diff --check` 通过。
- `impeccable` detector 检查修改的 Webview 文件，结果 `[]`；复用已有主题与工具设置样式，没有新增颜色或样式体系。
- 功能清单、能力规格、设置消息设计、Loop+ 调度设计、CLI 运行时参考和 ontology 已同步。保留既有未提交的 Loop+ 修复。
- 未运行完整单元套件、真实模型请求或 Extension Development Host；本次变更仅涉及已有设置链路，生产接线、存储与配置优先级由上述相关测试覆盖，浏览器消息桥采用模拟宿主。
