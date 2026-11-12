# 非运行对话标签关闭性能优化

- 日期：2026-11-12
- 类型：perf
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

关闭非运行标签会进入 `postPanelState`，重载所有 CLI 配置、刷新模型与 OpenCode 能力，并重发当前对话。活动标签关闭还要先等待回退标签配置恢复，因此标签移除反馈被无关慢操作阻塞。

## 范围与非目标

- 优化宿主关闭链路与 Webview 的关闭确认消息，沿用现有分页、主题、运行锁和会话保留规则。
- 后台标签关闭不刷新配置、不重发当前对话、不重选当前会话；活动标签先确认关闭，再完成既有配置恢复与消息同步。
- 不改 CLI 配置格式、运行生命周期、依赖或其它正在进行的模型管理改动；不发布扩展。

## 验收标准

- 非运行后台标签关闭不调用全量面板刷新和对话重放，活动会话不变。
- 活动标签关闭确认早于慢配置恢复，回退配置仍正确恢复；并发切换不重放过期目标。
- 运行中标签、运行中 Loop 主标签和最后一个标签保持关闭限制。
- 单测覆盖成功、边界、拒绝与并发路径，构建通过，并完成真实 Chromium Webview 脚本验证。

## 影响面与风险

- 代码：`src/extensionHost/sessionTabs.ts`、`src/sessionTabs.ts`、宿主依赖接线、Webview 消息分发及相关测试。
- 文档：功能清单、运行时语义导航与本计划。
- 风险：轻量确认不得删除会话，也不得改变后台关闭时的当前对话；复用现有缓存切换及清理函数，配置仍由既有全量状态恢复。
- 回滚：移除关闭确认消息与后台快路径，恢复原有全量刷新。

## 验证计划

- `npm run build` 后运行标签关闭、配置恢复、分页、运行锁、任务摘要和 Webview 消息分发相关单测。
- 用真实生成的 Webview 脚本执行 headless Chromium，模拟慢配置恢复，断言关闭及时反馈、后台正文 DOM 不重建、运行锁不变。
- 对改动范围执行空白校验；本体更新后运行校验与既有脚本测试。

## 实施结论

- 已完成有界记忆召回与本体查询，核实当前代码；工作区原有模型管理等未提交改动保持不变。
- 新增宿主权威 `conversationTabClosed` 增量确认，在 runner 清理、配置恢复和全量状态之前发出；后台关闭直接结束，不触发全量配置刷新、活动会话重选或正文重放。
- Webview 复用原有缓存清理和活动消息切换；后台只重绘标签，活动关闭先显示回退缓存。重复确认忽略，保留更新的本地选择。
- 最后标签未真正移除时不发确认、不回收 runner；运行锁保持原有保护。
- 重置会话显式禁用提前关闭确认，在完整状态中原子发布新标签，避免客户端误选邻居及破坏待提交配置保留；消息回传前再次检查活动标签。

## 测试与清单同步

- 单元测试：更新 `src/test/session/sessionTabCliSwitch.test.ts`，新增 `src/test/webview/conversationTabClose.test.ts`。覆盖后台快路径、慢恢复前确认、运行与最后标签保护、重复/连续关闭、配置回退、并发切换、七种 CLI 重置、缓存清理和正文不重绘。
- 构建：`npm run build` 通过（日志 `/tmp/sinitek-idle-tab-build.log`）。
- 最终相关回归：`node --test dist/test/session/sessionTabCliSwitch.test.js dist/test/webview/conversationTabClose.test.js dist/test/session/conversationTabLock.test.js dist/test/session/conversationTabConfiguration.test.js dist/test/session/conversationTabModelSelection.test.js dist/test/session/conversationTabPagination.test.js dist/test/session/conversationTabRunningFlow.test.js dist/test/session/loopPlusSessionTabs.test.js dist/test/session/conversationTaskSummary.test.js dist/test/session/loopTabMemberTooltip.test.js dist/test/webview/conversationtabsummarytooltip.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js`，138/138 通过（日志 `/tmp/sinitek-idle-tab-focused.log`）。
- 扩大 Webview 回归：`node --test dist/test/webview/clipagescriptruntimecoverage.test.js`，181/184 通过（日志 `/tmp/sinitek-idle-tab-runtime.log`）。3 项范围外失败为 ZCode 模型展示、ZCode 空配置、DSH 下拉选项断言；当前模型管理实现新增 `__manage__`，旧断言未包含。使用临时 require hook 禁用本次新增关闭处理函数与消息分支，再按 `--test-name-pattern='ZCode model dropdown|ZCode empty configuration|DSH dropdowns list'` 执行，原样复现 3/3 失败（日志 `/tmp/sinitek-idle-tab-baseline.log`）；未改动这些模型功能和断言。
- 实施中先修复新增测试夹具遗漏的必填 `sessionIdByCli`；初轮回归发现会话重置依赖原关闭路径刷新，已恢复其显式完整刷新并增加禁止提前确认的断言，最终相关回归全部通过。
- Chromium：用 `getWebviewHtml` 生成完整真实页面，以 HTTP 桥接生产 `createSessionTabsController` / `createExtensionSessionTabsHost`，使用 500 条正文与 1500 ms 的受控配置恢复延迟。按 `chromium-playwright-smoke` runner 执行桌面深色 1200×800、窄屏浅色 420×800，全部通过，浏览器错误、HTTP 错误、网络失败均为零。桌面后台/活动关闭为 10/8.5 ms，窄屏为 12.4/6.7 ms；后台正文节点、消息数组及滚动位置保持不变，活动立即显示回退缓存，运行/最后标签保护通过。
- 浏览器结果与截图：`.tmp/idle-tab-close/desktop/result.json`、`.tmp/idle-tab-close/desktop/success.png`、`.tmp/idle-tab-close/narrow/result.json`、`.tmp/idle-tab-close/narrow/success.png`、`.tmp/idle-tab-close/metrics.json`（本地忽略产物）。初次浏览器验证仅测试上报接口返回 204 导致请求中止，改成 200 并等待上报完成后重跑通过，未放宽错误白名单。
- 静态校验：改动文件空白检查与 `git diff --check` 通过；Impeccable 对两个 Webview 文件的机械检测为空数组；本体 `--validate` 通过，脚本测试 9/9 通过。
- 同步：功能清单新增“非运行对话标签关闭性能”，运行时设计记录增量确认及重置边界，本体新增 `plugin.rule.conversation_tab_close_fast_path`。
- 记忆收尾：可复用边界已进入运行时设计与本体，不重复写滚动摘要、事件记忆或 runbook；无新用户偏好或架构变化。

## 验证边界

- 2026-11-12 提交前隔离验证：仅暂存本任务 11 个文件；共享的 `src/extension.ts`、消息分发、功能清单和本体均按片段排除模型管理改动。使用 `git checkout-index` 导出暂存快照，在独立临时目录执行 `npm run build` 及前述相关回归与 `clipagescriptruntimecoverage`，322/322 全部通过；日志 `/tmp/sinitek-idle-tab-commit-validation.log`。此前 3 项模型管理断言失败不在本次独立提交中复现，其它工作区改动保留且未暂存。

- 浏览器使用生产宿主控制器和真实生成 Webview，但 VS Code API 桥接与配置恢复为受控夹具；未启动完整 VS Code Extension Development Host，也未调用真实模型 provider。
- 延迟数据仅为上述本机受控场景，不承诺用户机器上的固定毫秒数。
- 未发布扩展；用户需在加载本地构建的开发宿主中重载后体验，不能把源代码修改视为已安装扩展自动升级。
