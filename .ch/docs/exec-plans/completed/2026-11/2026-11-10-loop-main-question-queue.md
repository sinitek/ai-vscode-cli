# Loop / Loop+ 主模型低优先级提问队列

- 日期：2026-11-10
- 状态：completed
- 负责人：Codex

## 背景与目标

“我要提问”在主模型忙碌时被前后端拒绝。改为提示“主模型正在处理，你的问题会放入队列。”并允许提交；主模型空闲自动按提交顺序回答，验收与补充需求优先。

## 范围与非目标

- 覆盖群聊提问交互、主会话串行调度、取消、回归测试、功能与本体同步。
- 不改变主任务验收规则、子任务调度、普通对话抢占语义，不增加依赖。
- 提问历史沿用持久化；宿主重启后未结束的提问沿用停止恢复规则，不自动重放。

## 验收标准

- 忙碌提示使用指定中文，忙碌时仍可提交连续问题。
- 同一主会话提问 FIFO，不与主任务并发；已排队的验收、补充需求先执行。
- 主模型空闲时自动回答，前一个提问失败不丢弃后续问题。
- 取消等待中的提问不停止主任务；正在回答时仅停止本次提问并清空待问队列。
- 保留历史与弹窗草稿，遵循原主题和跨平台实现。

## 影响面与风险

- 代码：`src/loopMainQuestionQueue.ts`、`src/loopAskThread.ts`、`src/extension.ts`、`src/extensionHost/loopGroupChatPanelCoordinator.ts`、`src/extensionHost/loopPlusOrchestration.ts`、群聊 Webview。
- 文档：功能清单、Loop+ 调度设计、运行时 ontology。
- 风险：空闲检测与异步准备竞争、取消误杀主任务、排队答复覆盖后续问题；使用会话级互斥和优先队列，并补并发与取消用例。

## 验证计划

- `npm run build` 后运行相关 Loop 提问、群聊和 Loop+ 编排测试。
- 补优先级、FIFO、失败、取消、跨 Tab 隔离回归测试。
- 使用 headless Chromium 验证实际生成 Webview 的忙碌提交、连续提交和状态更新；不调用付费 CLI。
- 运行 ontology 校验与单测、改动范围空白检查。

## 测试与清单同步

- 单元测试新增/更新：新增会话优先队列的 FIFO、互斥、取消、失败释放与跨 Tab 隔离用例；补充经典 Loop 门禁、Loop+ 高优先级工作保留区与真实编排/队列组合回归；更新连续提问 UI、协调器和持久化测试；补异步压缩/配置准备取消后不迟到启动与租约释放测试。
- 单元自测结果：`npm run build` 通过；下列 12 个相关测试文件共 300 项通过。`npm run test:unit` 共 3576 项，3567 通过、6 项历史失败、3 项按既有条件跳过。
- 失败处理记录：新增组合测试最初错误预期用户消息后额外执行 closeout，按现有状态机修正夹具。全量发现 AST/VM 入口测试只载入旧 `runPrompt` 且缺少摘要依赖 mock，更新为同时载入入口与执行体并补必要 mock，入口相关测试全通过。剩余 6 项在 `git archive HEAD src package.json tsconfig.json` 的隔离副本编译并运行相同测试后全部复现，未修改范围外测试或实现：4 项 `loopPlusGroupChatPanel.test.ts` 仍断言已移除的侧栏验收明细，2 项 `looppluswebviewintegration.test.ts` 缺少 `retainChatBubbleEntries` VM 依赖。
- 功能清单与本体：已更新 `FEATURE_INVENTORY.md`、`loop-plus-scheduling.md` 和 `plugin.rule.loop_main_model_question`；本体校验通过，ontology Python 单测 9 项通过。现有架构层级不变，详细并发约定记入调度设计，不扩写 `ARCHITECTURE.md`；不覆盖另一任务正在维护的能力详情文档。

### 实际验证命令与证据

```bash
npm run build
node --test dist/test/loop/loopMainQuestionQueue.test.js dist/test/loop/loopMainQuestion.test.js dist/test/loop/loopAskThread.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/loopOrchestration.test.js dist/test/core/panelDiagnostics.test.js dist/test/extensionHost/promptSessionHealth.test.js dist/test/extensionHost/loopPlusEntryRouting.test.js
npm run test:unit
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'
git diff --check
node scripts/check_trailing_whitespace.js src/loopMainQuestionQueue.ts src/test/loop/loopMainQuestionQueue.test.ts src/test/extensionHost/promptSessionHealth.test.ts src/test/extensionHost/loopPlusEntryRouting.test.ts
```

- Chromium：通过 `chromium-playwright-smoke` 运行 1280×900 经典 Loop 忙碌连续提交、430×900 Loop+ 自动顺序回答、430×900 等待取消三个场景，均无浏览器、HTTP 或请求错误；已查看截图。页面由真实群聊面板、协调器、提问 helper 与优先队列生成，VS Code bridge 和 CLI 使用本机受控替身，不等同于真实 Extension Development Host / 付费 CLI 验收。
- 页面结果与截图保留于 ignored 的 `.tmp/loop-question-queued-desktop/`、`.tmp/loopplus-question-drain-narrow/`、`.tmp/loopplus-question-cancel-narrow/`；测试服务器与一次性场景文件已清理。
- UI 机械检查：Impeccable detector 返回空问题列表；改动范围空白检查通过。
- 未运行真实模型调用或扩展发布：此次不改变 CLI 协议，使用受控执行覆盖时序，不产生模型费用；遵守禁止发布脚本的约束。

## 任务列表

- [completed] 梳理提问入口与调度优先级
- [completed] 实现低优先级提问队列
- [completed] 补充测试并同步功能文档
- [completed] 验证构建与队列行为

## 决策记录

- 2026-11-10：主会话使用互斥队列；主任务调用高于提问，已开始的提问不因后来验收到达而被抢占。提问不写入补充需求或验收事件。

## 当前结论

已完成指定文案、连续提问 FIFO、主会话优先级互斥与取消隔离。300 项相关测试及三个浏览器场景通过；全量只剩隔离 HEAD 可复现的六项历史失败。按 MEMORY 规则，稳定规则已进入设计、功能清单与 ontology；本次无需新增热区记忆、EVENT_MEMORY 或 ROLLING_SUMMARY。
