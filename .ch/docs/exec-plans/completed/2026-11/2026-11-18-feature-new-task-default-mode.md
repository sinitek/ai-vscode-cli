# 新建与重置任务的默认模式

- 日期：2026-11-18
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 目标与范围

工具设置 → AI任务配置提供全局单选项。新建、重置对话任务时采用 Vibe、Loop 或 Loop+；缺失或非法配置回退到 Vibe。保存设置时不切换当前任务。历史、续跑、已有标签切换和运行中的重置保护沿用现有规则。

## 验收标准

- 三种模式可保存并随面板状态恢复；非法更新不覆盖已保存值，写入失败回显保存前状态。
- 新建立即显示所选模式，宿主确认后保持一致；重置只替换目标标签并使用同一全局配置。

## 影响面与风险

复用全局工具设置、宿主模式选择和 Webview 状态同步，不迁移历史数据。重点检查新建等待宿主回包时不会被旧标签的模式覆盖，以及重置不会丢失目标 CLI 或影响邻居标签。

## 验证计划

执行 `npm run build` 后验证工具设置、消息路由、标签重置和 Webview 运行时。核对本体与功能清单；用 Chromium 验证生成的 Webview 选择控件。

## 验证结果

- `npm run build`、`git diff --check` 和 `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过。功能清单、运行时设计和本体已同步；没有需要另写热区记忆的变更。
- 直接相关 12 条用例通过：`node --test --test-name-pattern='new task mode|tool settings persist globally|the global default is saved|resetting a .* conversation replaces|default task mode setting|new tab appears in the configured mode' dist/test/core/toolSettings.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`。
- 相关回归通过：`node --test --test-reporter=dot dist/test/core/toolSettings.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/session/conversationTabLock.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/loopPlusModeEntry.test.js dist/test/webview/multiAgentSettingWebview.test.js dist/test/webview/conversationTabClose.test.js`。
- 扩大到 `looppluswebviewintegration.test` 时，一条历史展示断言的脚本夹具缺少 `isCreatingConversationTab`，在未修改的 `ce942269` 上单独构建并复现了同一失败，未改动该夹具。
- 生成的完整 Webview HTML 在 Chromium 360 / 960 px 下均通过：正确显示 Vibe、Loop、Loop+，三项都能提交设置，当前模式不变，控件无重叠，无浏览器错误。使用模拟 VS Code 消息桥，未运行真实图形扩展宿主或 CLI，也未跑全仓单测。
