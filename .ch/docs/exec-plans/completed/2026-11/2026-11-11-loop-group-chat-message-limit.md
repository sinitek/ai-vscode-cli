# Loop / Loop+ 群聊气泡显示上限

- 日期：2026-11-11
- 状态：completed
- 负责人：Codex

## 背景与目标

群聊长任务会持续增加页面气泡；为 Loop、Loop+ 增加独立显示上限，默认 200，并复用工具设置的 AI 任务配置入口。

## 范围与非目标

- 范围：全局设置持久化、面板状态、首次及增量渲染、边界测试、功能清单与 ontology。
- 非目标：不改变普通对话的气泡保留规则，不删除群聊 transcript、任务记录或 CLI 上下文，不改变调度。

## 验收标准

- 默认 200；达到上限时批量移除最旧 25%（向上取整，默认 50），只渲染最新窗口。
- 数值范围 1–10000，整数规范化；非法输入回退 200；极小上限至少保留最新一条。
- 初始任务、聊天和运行中思考气泡共用限额；首次打开、连续更新、历史长记录均受限，更新不恢复已裁剪前缀。
- 设置保存后刷新已打开群聊；调大限额或重新打开可重新展示存档中的较早消息。

## 影响面

- `src/toolSettings.ts`、`src/chatMessageLimit.ts`、设置协议与 Webview、群聊面板与协调器。
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`、群聊显示设计与 ontology。

## 风险与缓解

- 普通对话现有清理规则与群聊规则不同：使用独立设置键与显示窗口，禁止复用永久清理通道。
- 思考气泡退出会减少计数：同一面板保存裁剪游标，避免旧消息重新出现。
- Windows/macOS/Linux：仅使用既有全局设置存储，不增加平台相关路径。

## 验证计划

- 单元自测：`npm run build` 后运行限额、工具设置、设置事件、群聊面板与 Loop+ 面板相关测试。
- 浏览器：使用现有 Chromium/Playwright 对实际生成 HTML 与设置控件进行最小验证。
- 结构：ontology validate、对应 Python 单测、空白检查。

## 测试与清单同步

- 单元测试新增/更新：气泡选择纯函数、初始与增量 HTML、面板实例游标、任务切换与关闭重开、Loop+、控件及状态回传、全局持久化与保存失败、协调器配置读取。
- 单元自测结果：`npm run build` 通过；下述最小相关测试 338/338 通过。
- 失败处理记录：初轮新增测试夹具使用了不被 transcript 识别的“主任务决策”标题，已改成正式“主任务发言：第 N 轮”；持久化夹具补充新增设置字段，重跑通过。扩大回归发现 9 项历史失败，已用 HEAD 原实现复核一致，未修改范围外代码。
- 功能清单：已新增独立“Loop / Loop+ 群聊气泡显示限额”条目。
- 设计及 ontology：新增群聊显示窗口设计与 `plugin.rule.loop_group_chat_message_limit`；ontology validate 与 9 项 Python 测试通过。

## 验证记录

### 构建与相关单测

```bash
npm run build
node --test dist/test/core/chatMessageLimit.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/loop/loopGroupChatBubbleRetention.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/loop/loopPlusPanelState.test.js
```

结果：338 项全部通过。覆盖默认 200→150、249→199、250→150、长历史、小上限保留最新一条、输入边界、窗口不回填、调大恢复与两种群聊模式。

### 扩大回归与失败分流

- `dist/test/loop/loopPlusGroupChatPanel.test.js`：15 项中 11 通过、4 失败，旧断言仍查找已经不存在的 `current` / `reviewed` 统计及 `验收结果` 文案。
- `dist/test/webview/chatBubbleRetentionWebview.test.js`：12 项中 7 通过、5 失败，旧 VM 夹具缺少 `parseCompleteJsonContainer`。
- 复核命令：`node --require ./.tmp/loop-group-chat-baseline.cjs --test dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/webview/chatBubbleRetentionWebview.test.js`。本机临时 hook 将本次修改的已跟踪运行时 TypeScript 全部替换成 `git show HEAD:<path>` 经现有 TypeScript 编译的版本，不改工作区；仍是相同 9 项失败。归类为历史断言/夹具问题，不扩大修复。

### 真实 Chromium 页面验证

- 命令：`node .tmp/loop-group-chat-limit-smoke.cjs`；使用现有 Playwright 与本机 Chromium，无安装依赖、无真实 CLI 调用、无用户设置写入。
- 以当前构建生成真实 Webview HTML，在本地临时 HTTP 服务注入 VS Code 消息桥；非独立 Web 应用，无登录 API，故无需认证。Loop / Loop+ 在 1440px、390px 共 4 组合通过首次裁剪、思考结束、增量增长、第二批裁剪、改变上限与 4000 条长历史验证。
- 设置页在两种宽度验证默认 200、320.9→320、空值→200、宿主回传 120、普通气泡上限仍为 500；结构化 smoke runner 的两份 result 均 `passed`，浏览器/网络错误均为空。
- 本机结果：`.tmp/loop-group-chat-limit-smoke/integration-result.json`、`settings-1440/result.json`、`settings-390/result.json`。已检查两种尺寸设置截图，沿用语义主题、标签和现有布局，无控件遮挡。
- UI 机械检查：`node /Users/fangjiawei/.codex/skills/impeccable/scripts/detect.mjs --json src/webview/viewContentHtml.ts src/webview/loopGroupChatPanel.ts`，结果 `[]`。
- `git diff --check` 通过；ontology validate 通过，ontology Python 单测 9/9 通过。

### 未覆盖范围

未运行全仓单测、严格全仓覆盖率、真实 Extension Development Host、真实模型/CLI，以及 Windows/Linux 本机验证。实现不新增平台路径，跨平台设置读写继续复用现有模块。

## 任务列表

- 定位群聊气泡与设置入口：已完成。
- 实现限额、持久化与窗口：已完成。
- 测试、文档与验证：已完成。

## 决策记录

- 2026-11-11：按页面显示限制实现，不删除存档；裁剪批量随上限按 25% 缩放，默认 200/50。

## 当前结论

已完成独立全局设置与非破坏性群聊窗口，构建、338 项相关测试、Chromium 宽窄屏、ontology 与静态校验通过。9 项扩大回归失败经 HEAD 基线确认既有；不影响本次新增能力。无额外热区记忆、EVENT_MEMORY 或 runbook 变更：本轮无新的可复用踩坑或跨会话风险，稳定契约已保存在设计、功能清单与 ontology。
