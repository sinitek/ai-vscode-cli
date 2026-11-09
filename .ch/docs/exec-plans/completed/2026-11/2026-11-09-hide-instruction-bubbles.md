# 隐藏指令气泡设置

- 日期：2026-11-09
- 状态：completed
- 负责人：Codex

## 背景与目标

在工具设置 → AI任务配置增加“隐藏指令气泡”，默认关闭；开启后隐藏 AI 对话面板所有按现有规则归类为指令的气泡。

## 范围与非目标

- 复用全局工具设置 `~/.sinitek_cli/settings.json`、宿主面板状态及现有 `isInstructionBubble` 分类。
- 仅过滤显示，不改变指令执行、消息存档、现有气泡永久清理规则或最终结果筛选。
- 不新增依赖、主题、工作区覆盖项，不修改 CLI 协议或 Loop 群聊面板。

## 验收标准

- 设置位于 AI任务配置，默认未勾选，旧设置缺失及非法值均视为关闭。
- 勾选立即隐藏历史及新增指令气泡，包括连续指令组；取消后恢复尚未被既有清理规则删除的消息。
- 用户、系统、思考、最终答复及交互操作气泡保留既有行为；切换标签页和重新加载仍遵循全局设置。
- 保存失败提示中文错误并由宿主真实状态回滚；完成相关单测、构建及浏览器冒烟。

## 影响面与风险

- 代码：工具设置、宿主消息处理与状态构建、Webview 设置及渲染链路、相关测试。
- 文档：功能清单、运行时 ontology。
- 风险：误删消息或改变原有分类；缓解为复用分类并在既有保留筛选之后仅过滤显示。
- 回滚：撤销新增设置及显示过滤；已有消息数据不需要迁移。

## 验证计划

- `npm run build`，然后运行工具设置、宿主消息、面板状态与 Webview 相关最小测试。
- 使用 headless Chromium 验证开关、历史及增量消息、指令组、标签页切换和恢复显示。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与改动范围空白检查。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/webview/hideInstructionBubbles.test.ts`，覆盖默认关闭、分类过滤、历史恢复、标签页/增量消息、最终结果筛选、空集合、即时渲染及旧快照兼容；扩展工具设置持久化、宿主保存失败和面板状态回归。
- 构建：`npm run build` 通过。
- 最小自测：`node --test dist/test/webview/hideInstructionBubbles.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/chatBubbleRetentionWebview.test.js dist/test/webview/instructionGroupSummary.test.js`，88 项全部通过。
- 扩展回归：`node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/multiAgentSettingWebview.test.js dist/test/webview/notificationAuthorization.test.js dist/test/webview/chatBubbleRetention.test.js dist/test/core/chatMessageLimit.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js`，254 项全部通过。
- 浏览器：`node .tmp/hide-instruction-bubbles-smoke.cjs` 复用项目 Chromium smoke runner，在 1280px 和 420px 下共 12 个场景通过，覆盖默认开关、即时隐藏、标签页与增量消息、取消恢复、已保存状态重载、保存失败回滚和仅指令时空状态。已检查宽/窄设置页与隐藏后的截图，浏览器/网络错误为 0。结果：`.tmp/hide-instruction-bubbles-smoke/summary.json`；各场景目录含 `result.json` 和截图，任务级 scenario JSON 已删除。
- 浏览器验证边界：使用当前构建的完整 Webview HTML/CSS/JS 和合成数据，模拟扩展宿主消息；未启动真实 VS Code Extension Development Host、未调用真实 CLI，未执行 Windows/Linux 原生环境验证。
- 失败处理记录：首轮浏览器夹具将已关闭弹窗中的复选框误设为等待可见；改为等待节点附着后完整重跑 12 场景通过，非实现缺陷。单元测试无失败。
- 功能清单和 ontology：已同步“隐藏指令气泡”规则；ontology 校验通过（119 条规则）。设计 detector 未发现问题。
- 记忆判断：本次局部设置功能无独立热区记忆价值，事实保留在规格、ontology 和本计划。

## 当前结论

功能与文档已交付，342 项相关单元测试、构建、12 个 Chromium 场景、ontology 和改动范围空白检查均通过。无需改动 CLI 执行协议、主题或长期记忆热区。
