# 提示词队列与完成提醒边界修复

- 日期：2026-11-17
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

Vibe 成功记录在宿主触发完成提醒，待发送队列只存在于 Webview，导致仍有后续工作时提醒。Loop / Loop+ 主任务存在自动入队分支，子任务也能使用冲突弹窗入队。

## 范围与验收标准

- 任一 Tab 存在待发送提示词时，Vibe 不发送系统完成通知或图标提醒；队列清空后后续成功运行正常提醒。
- Loop / Loop+ 模式、主任务和子任务不能加入提示词队列；拒绝后保留输入，普通 Vibe 排队正常。
- 队列出队、删除、重置、关页和 Webview 释放同步清理提醒门禁；后台 Tab 同样生效。
- 保留独立群聊提问、补充需求及 Loop+ 调度器自己的队列。
- 不改技术栈、CLI 协议或既有无关样式。

## 影响面与风险

涉及 Webview 队列/冲突弹窗、前后端消息协议、完成提醒策略和宿主接线。同步仅传递是否存在队列项，不传提示词；在出队派发前同步，防止最后一项完成仍被旧状态静默。已有工作区样式及功能清单修改保留。

## 验证计划

- `npm run build`。
- 完成策略、宿主记录、消息路由、队列与相关 Webview 回归。
- headless Chromium 验证 Vibe 入队与 Loop / Loop+ 主子任务拒绝，检查浏览器错误。
- ontology 校验及其 Python 单测、改动空白校验。

## 当前阶段

实现、验证和文档同步已完成，无未决问题。Webview 汇总所有 Tab 的待发送队列，以布尔消息同步宿主；宿主在记录 Vibe 成功运行时检查门禁，抑制系统通知和图标提醒。被抑制的通知不补发，队列清空后后续成功运行正常提醒。

Loop / Loop+ 模式、主任务和子任务共用入队资格判断；冲突弹窗禁用队列按钮，直接入队和历史队列派发也有防护。拒绝时保留草稿和上下文。队列出队、删除、运行时重置、Tab 移除，以及 Webview 重载、替换和释放均同步清理状态。

## 验证结果

- `npm run build`：通过。
- 以下相关单测共 335 项，通过 335 项，失败、取消和跳过均为 0；完整输出位于 `/tmp/prompt-queue-tests-final.log`。

```bash
node --test --test-reporter=tap \
  dist/test/core/taskCompletionAttention.test.js \
  dist/test/extensionHost/taskCompletionAttentionHost.test.js \
  dist/test/webview/promptQueuePolicy.test.js \
  dist/test/loop/loopPromptQueue.test.js \
  dist/test/webview/loopPlusModeEntry.test.js \
  dist/test/webview/looppluswebviewintegration.test.js \
  dist/test/webview/clipagescriptruntimecoverage.test.js \
  dist/test/webview/tabRunStatus.test.js \
  dist/test/webview/viewProvider.test.js \
  dist/test/session/sessionMessageHandlersCoreCoverage.test.js \
  dist/test/webview/loopPlusAcceptancePlanDialog.test.js \
  dist/test/loop/opencodeloopmodewebview.test.js \
  dist/test/session/conversationTabLock.test.js \
  dist/test/webview/conversationTabClose.test.js
```

- 新增 `promptQueuePolicy.test.ts` 覆盖 Loop 模式、主子 Tab、队列快照、跨 Tab 汇总、后台出队顺序、删除/重置/裁剪和消息类型校验；完成策略、宿主记录和 Webview 生命周期补充回归。保留 Vibe 配置快照、编辑和后台派发覆盖。
- `node .tmp/prompt-queue-smoke/verify.cjs`：真实完整 `getWebviewHtml` 页面、模拟宿主消息、headless Chromium 共 7 项检查通过，页面、控制台和请求错误为 0。覆盖 Vibe 入队、删除最后一项、Loop / Loop+ 主子任务拒绝并保留草稿，以及 390px 窄视口。结果为 `.tmp/prompt-queue-smoke/result.json`，截图为同目录 `loop-subtask.png`、`loop_plus-subtask.png`、`narrow-child.png`。临时验证脚本与产物不纳入版本控制。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 个域、17 个概念、16 个关系、153 条规则、2 个工作流。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- UI 机械检测结果为 `[]`，记录于 `/tmp/prompt-queue-ui-detect.json`；`git diff --check` 通过。
- 早期失败分类：新增测试夹具的 TypeScript 类型/提取函数依赖问题，以及仍预期 Loop 入队的过期断言，均已修正并在上述最终运行通过；无未解决失败。

## 文档、边界与回滚

已同步 `ARCHITECTURE.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、能力分册及 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。现有无关修改保留。没有新增需要跨会话召回的经验或运行前置条件，无需修改热区记忆、runbook、`ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md`。

浏览器验证使用生产页面和模拟 VS Code API，没有启动真实 CLI、Extension Development Host 或实际操作系统通知，也没有在 Windows 上运行。原生通知传输未改动；本次新增策略和宿主接线有单测覆盖。无依赖、技术栈、CLI 协议或持久化数据迁移。若需回滚，撤销本次队列门禁、布尔同步及对应测试/文档修改即可，无数据恢复步骤。
