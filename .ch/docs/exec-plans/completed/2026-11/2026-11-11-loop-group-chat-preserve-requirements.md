# Loop / Loop+ 清理气泡时保留补充需求

- 日期：2026-11-11
- 状态：completed
- 负责人：Codex

## 背景与目标

群聊上限当前按连续前缀清理，导致较早提交的补充需求也从页面消失。本次在经典 Loop 与 Loop+ 共用的选择器中保护补充需求，保持原有全局配置、批量比例及非破坏性显示契约。

## 范围与非目标

- 范围：群聊选择器、时间线投影、回归测试、功能清单、设计及 ontology。
- 非目标：不改变普通聊天保留规则、群聊文件、模型上下文、任务调度、主题和设置控件。
- 工作区存在其它任务的未提交改动；仅定点修改本任务相关规则，不覆盖或归档其它任务计划。

## 验收标准

- Loop / Loop+ 初始 HTML 与增量 patch 均保留所有 `user-message` 补充需求，并维持原时间顺序。
- 所有可见气泡继续计数，触发清理后跳过补充需求，按原 25% 批次删除最旧可清理气泡。
- 至少保留最新气泡；受保护需求本身达到上限时允许超限，不循环清理或删除需求。
- 同一面板不回填已清理的普通气泡，改变设置仍重算；存档不变。

## 影响面与风险

- 代码：`src/webview/loopGroupChatBubbleRetention.ts`、`src/webview/loopGroupChatPanel.ts` 及对应测试。
- 文档：群聊限额设计、功能清单、`plugin.rule.loop_group_chat_message_limit`。
- 风险：保护消息多于上限、最新消息受保护、思考结束和重复刷新；由纯函数和双模式渲染回归覆盖。
- 跨平台：只操作内存数组，不新增路径或平台分支。

## 验证计划

- `npm run build`。
- `node --test dist/test/loop/loopGroupChatBubbleRetention.test.js dist/test/loop/loopGroupChatPanel.test.js`，再扩大至相关群聊解析与协调器测试。
- 当前构建生成的 Webview HTML 通过本机 headless Chromium 验证两种模式、默认/极小上限与增量更新；不调用真实模型，不写用户配置。
- ontology `--validate`、相关 Python 单测及 `git diff --check`。

## 测试与清单同步

- 新增回归：保护早期及穿插需求、连续清理、重复刷新、重设上限、需求超限、全部受保护、双模式首次及增量渲染。
- 自测结果：`npm run build` 通过；最小相关单测 69/69 通过，扩大相关回归 122/122 通过，具体命令见验证记录。
- 失败处理记录：无构建、单测或浏览器失败。
- 功能清单、设计与 ontology：已同步补充需求保护、完整批次清理、计数与允许超限的契约。

## 验证记录

### 构建与单元测试

```bash
npm run build
node --test dist/test/loop/loopGroupChatBubbleRetention.test.js dist/test/loop/loopGroupChatPanel.test.js
node --test dist/test/loop/loopGroupChatBubbleRetention.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopGroupChat.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/extensionHost/loopPlusSubtaskChat.test.js dist/test/loop/loopPlusPanelState.test.js
```

结果：构建通过；最小相关测试 69 项全部通过，扩大回归 122 项全部通过。覆盖原有无保护窗口、补充需求穿插、连续批次、不可变输入、重复刷新、改变设置、需求多于上限、全部受保护、最新气泡和 Loop / Loop+ 首次及增量渲染。

### 本机真实 Chromium 验证

- 命令：`node .tmp/loop-group-chat-preserve-requirements-smoke.cjs`；复用本机 Playwright、Chromium 与 skill 结构化 smoke runner，无安装、无模型调用、不写用户配置。
- 使用当前构建生成完整 Webview HTML，临时 HTTP 服务仅注入 VS Code 消息桥与主题变量；该页面无登录 API，不需要认证。
- 经典 Loop / Loop+ × 1440px / 390px 共四组全部通过；默认 200 上限且混有两条补充需求时，初始及追加消息后的清理均保留 152 条，并保留早期需求；改为上限 1 后保留两条需求及最新普通消息共 3 条；全部为需求时保留 8 条，重复刷新不丢失。
- 四份结构化 smoke `result.json` 均通过，浏览器异常、控制台错误、失败请求和 HTTP 错误均为空；任务临时场景 JSON 已删除。
- 结果：`.tmp/loop-group-chat-preserve-requirements-smoke/integration-result.json`。已检查宽屏首次清理与窄屏超限保护截图，沿用原布局及主题，无新增遮挡。

### 结构与事实来源

- ontology `--validate` 通过，ontology Python 单测 9/9 通过，`git diff --check` 通过。
- 功能清单、设计及 `plugin.rule.loop_group_chat_message_limit` 已同步。
- 未运行全仓测试、全仓严格覆盖率、真实 Extension Development Host / CLI / 模型，以及 Windows/Linux 本机验证；本次仅改内存筛选与 HTML 投影，不涉及平台路径或 CLI。

## 任务列表

Tasklist:
- [completed] 定位 Loop / Loop+ 气泡清理逻辑
- [completed] 修改保留规则并补充回归测试
- [completed] 完成验证并同步相关文档

## 决策记录

- 2026-11-11：补充需求按 transcript 的 `user-message` 类型保护；初始任务发起气泡不扩大保护范围。补充需求继续计入阈值，清理跳过它们并删除完整批次的普通气泡；需求本身过多时显式允许超限。

## 当前结论

已完成两种群聊的补充需求保护，构建、122 项相关测试、四组 Chromium 验证与 ontology 校验均通过。无额外热区记忆、EVENT_MEMORY 或 runbook 更新：稳定行为已沉淀到设计、功能清单及 ontology，本轮无新的可复用环境踩坑或跨会话风险。工作区中其它任务的改动保持原样。
