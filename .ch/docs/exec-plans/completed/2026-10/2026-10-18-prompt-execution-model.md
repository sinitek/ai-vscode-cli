# 会话提示词展示执行模型

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex

## 背景与目标

运行状态区“提示词”弹窗按会话倒序展示用户输入。每条提示词正文开头以 `[模型名] 正文…` 展示执行时使用的 AI 模型名，切换模型和恢复会话后保持原执行信息。

## 范围

为用户消息添加可选执行模型快照，覆盖 interactive（Codex/Claude/Grok）和 OpenCode one-shot/parallel 共用模板；复用现有消息替换与持久化链路。弹窗展示模型、最新标记，兼容窄面板。同步产品规格和 ontology。

## 非目标

历史提示词收藏弹窗、模型选择规则与 CLI 调用协议保持现有行为；不根据当前选择猜测旧消息的模型。

## 验收标准

- [x] 每条提示词正文开头以 `[模型名] 正文…` 显示执行模型名；Grok 使用配置中的模型显示名快照。
- [x] 新建和预加载消息均记录执行时的有效模型，恢复会话保留模型。
- [x] 旧消息显示“模型未记录”，无法解析具体默认名称时显示“CLI 默认模型”。
- [x] 多模型会话、后台 Tab、空态、内部协议过滤与最新标记兼容。
- [x] 构建、相关单测和 Chromium 实际交互验证通过。

## 影响面与风险

影响用户消息契约、运行宿主和提示词弹窗。新增可选字段兼容旧 JSON；模型信息在运行时解析完成后写入，避免将当前下拉用于历史消息。既有未提交工作保留。

旧记录无法恢复过去未保存的模型名，统一显示“模型未记录”。默认模型的具体名称无法解析时显示“CLI 默认模型”。如需回滚，可撤销模型快照写入和弹窗前缀渲染；既有会话 JSON 中的可选字段可保留。

## 验证计划

`npm run build`；提示词 Webview、interactive、OpenCode 模板/one-shot/parallel、会话持久化和模型设置相关单测；Chromium 运行完整 Webview，验证打开/关闭、切换 Tab、模型切换、消息恢复、空/缺失/长模型名和桌面/窄视口。通过消息桥注入合成数据，不调用真实模型。

## Tasklist:

- [completed] 确认运行时模型快照与消息持久化入口
- [completed] 实现模型记录、弹窗展示及规格同步
- [completed] 完成测试、浏览器验证与计划归档

## 决策记录

- 2026-10-18：按用户最新要求，模型名展示改为提示词正文的 `[模型名] 正文…` 前缀，保留原始提示词正文和独立的模型快照字段。
- 2026-10-18：会话消息目前没有模型字段，新增可选 `executionModel` 保存执行时显示名；null 表示 CLI 默认模型，字段缺失表示旧记录未知。
- 2026-10-18：浏览器交互发现已打开弹窗收到 `replaceMessage` 后未刷新；在活动会话消息替换后同步提示词弹窗，补充活动与后台会话回归测试。

## 测试与清单同步

- `npm run build`：通过。
- 以下相关单测共 141 项通过，无失败、取消或跳过：

```sh
node --test dist/test/webview/runPromptHistoryWebview.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/openCodePromptRunTemplate.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/session/sessionStoreCoreCoverage.test.js dist/test/session/loopAskConversationContext.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/panelViewLocation.test.js
```

- 新增/更新回归覆盖：正文前缀与原始内容保留、模型切换、Grok 显示名、预加载消息回填、默认/旧消息、会话持久化、活动弹窗刷新与后台 Tab 消息替换。
- Chromium + Playwright：完整 Webview 下实际选择模型、输入并提交、打开弹窗、切换会话；确认新旧模型快照、默认/旧记录/Grok 显示名、日期与最新标记、后台更新、空会话、Loop+ 内部协议过滤，以及全新 Webview 恢复会话。360px 窄面板长模型名换行正常，无浏览器页面、控制台或请求错误。
- 浏览器使用保留真实 CSP 的本机完整 Webview 与模拟宿主消息桥；本次未启动真实 CLI 或 VS Code Extension Development Host。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（domains=2、concepts=17、relations=16、rules=43、workflows=2、documents=3）。
- 本次涉及文件的 `git diff --check`：通过。尾随空白脚本发现 `src/webview/viewContentStrings.ts:67` 的历史空格，已核对 HEAD 中存在同样内容；本次新增内容无此问题，保留原行。
- 已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 和 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。
- 稳定行为已写入规格与本体，无额外跨会话记忆事件；临时浏览器脚本、日志与截图在收尾时清理。
