# 首轮报错后重试保留会话气泡

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

新会话首次执行尚未产生正常回复便报错时，健康检查会在下次任务前解除异常会话绑定、清空草稿并发送空 `setMessages`，导致原任务的用户气泡和错误记录从当前 Tab 消失。保留自动新建底层 CLI 会话的隔离规则，同时保留用户可见的完整消息链。

## 范围与非目标

- 修改 `src/sessionLifecycle.ts` 的异常会话重建；补充现有生命周期回归测试并同步相关事实来源。
- 不改变健康状态判断、CLI 协议、显式自动命令修复重放、其它 Tab/CLI 或用户已有未提交改动。
- 当前工作区已有大量未提交修改，原地做最小补丁；不创建分支或 worktree，不覆盖已有工作。

## 验收标准

- 首轮只有用户气泡和错误的会话，再次执行后仍保留原始气泡、错误及新任务，顺序正确且无重复。
- 新任务不携带异常底层会话 ID；新会话接管草稿后消息持久化，旧存档不被新任务追加污染。
- 覆盖全部 CLI、local 会话 ID、后台目标与其它 CLI 隔离；显式 `forceNewSession` 行为保持不变。
- 最小回归、相关会话测试和 `npm run build` 通过。

## 风险与缓解

- 保留数组引用可能污染旧存档：使用独立草稿消息数组并验证旧文件内容。
- 自动修复重放可能重复追加用户气泡：仅普通异常续接保留草稿历史，显式 `forceNewSession` 仍清空。
- 历史前端消息不作为 CLI 续接参数，仍以空会话 ID 启动；不更改当前新任务输入。

## 验证计划

- 先更新 `src/test/session/sessionLifecycleCoreCoverage.test.ts`，确认旧实现回归失败，再修复重跑。
- `npm run build`
- `node --test dist/test/session/sessionLifecycleCoreCoverage.test.js dist/test/session/sessionHealth.test.js dist/test/extensionHost/promptSessionHealth.test.js`
- 按结果扩大到 session 与 interactive runtime 相关测试；生命周期测试使用本机临时目录检查实际消息文件与面板事件，不调用真实模型。

## 测试与清单同步

- 单元测试新增/更新：七种 CLI 的原始发起气泡、错误与重试记录保留；复制数组与消息对象隔离；新旧消息文件持久化；原生 ID 产生前连续 local 失败；后台 Tab/其它 CLI 隔离；显式自动命令修复继续清空重放。
- 红灯验证：旧实现运行新增保留断言失败，面板实际发送 `setMessages: []`，稳定复现用户气泡消失。
- `npm run build`：通过。
- 最小三份测试（生命周期、健康状态、统一任务入口）：31/31 通过。
- 扩展会话与 interactive/one-shot/parallel/auto-repair 测试：237 项中 234 通过、3 项范围外失败；隔离两份存在旧夹具问题的测试文件后，226/226 通过。
- Webview runtime 与提示词历史测试：97 项中 96 通过、1 项范围外失败。
- 失败分类与证据：`historySessionLoop.test.ts` 两项因夹具未提供 `formatCliDisplayName` 报 ReferenceError；`sessionStoreCoreCoverage.test.ts` 一项因预期空 store 未包含已有 ZCode 项失败；`clipagescriptruntimecoverage.test.ts` 的 Tab 错误标志用例一项预期 true、实际 undefined。独立复跑仍得到相同失败，并打印 `sessionLifecycle module loaded: false`，确认未加载本次修改的运行时模块；不修改这些已有工作区/夹具问题。日志为 `/tmp/sinitek-session-error-retry-tests.log`、`/tmp/sinitek-session-error-retry-isolated-failures.log`、`/tmp/sinitek-session-error-retry-webview-tests.log`、`/tmp/sinitek-session-error-retry-isolated-webview.log`。
- 本机消息持久化：生命周期测试使用临时目录实写新旧会话 JSON 并回读，确认旧文件只保留旧消息、新文件包含完整气泡链；`node scripts/validate_history_session_fix.js` 通过。
- Ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与对应 9 项 Python 单测通过。
- 空白校验：本次涉及文件的 `git diff --check` 通过。
- 提交前隔离验证：仅暂存本任务七个文件中的相关片段，排除其它 CLI 功能和共享文档改动；回归循环复用 `CLI_LIST`，不依赖未提交的 CLI 扩展。将暂存区导出到临时目录独立执行 `npm run build`、三份最小测试（31/31）与 ontology 校验，全部通过。
- 功能清单与相关文档：已更新 `FEATURE_INVENTORY.md`、能力规格、运行时参考和 ontology 的异常续接规则。
- 记忆维护：稳定规避原则写入运行时事实来源；无需重复写热区记忆或 runbook，不写 `ROLLING_SUMMARY.md`。
- 未执行：真实模型调用、VS Code Extension Development Host 手工验收和浏览器端到端操作；本次不改前端渲染，已验证宿主消息事件、消息持久化和相关 Webview 自动化。

## 当前结论

根因位于 `prepareSessionForPromptRun` 将底层会话替换误等同于清空当前 Tab 消息。现以三行运行时代码在普通异常重建时复制原消息到新草稿，保持空 CLI 会话 ID、runner 释放与旧存档隔离；显式自动命令修复重放不变。直接回归与构建已通过，扩展验证中的四项范围外失败已独立确认并记录，未扩大修复范围。
