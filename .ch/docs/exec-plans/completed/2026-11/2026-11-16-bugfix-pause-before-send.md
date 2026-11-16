# 暂停并发送等待完整收尾

- 日期：2026-11-16
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

Vibe 补充任务点击“暂停并发送”后出现共享配置锁超时。现有按钮直接发送，宿主停止回调提前移除活动标记，而原调用和配置租约仍在收尾。让显式暂停发送等待旧调用及其租约释放完成，禁止超时后迟到发送。

## 范围与影响面

- Webview 提交协议、宿主暂停等待、主 Prompt 调用与配置租约生命周期。
- 新增隔离运行时回归，保留 Loop 主任务排队行为。
- 不变更 CLI 依赖、配置锁协议或强拆其它存活宿主的锁，不执行发布脚本。

## 验收标准

- 停止标记已经清除但旧调用/租约尚未结束时，新请求仍等待。
- 停止超时、释放失败、标签关闭或换绑时不启动新请求，保留补充输入。
- 不同标签继续并行，普通发送和 Loop 主任务排队契约保持。

## 风险与缓解

- 旧调用不响应停止：有界等待并明确失败，不以 UI 空闲作为完成证据。
- 释放重试不应改写旧任务真实终态：单独跟踪待释放租约，暂停时再次确认释放。

## 验证计划

- `npm run build`。
- 运行暂停交接控制器、主 Prompt 配置生命周期、消息入口和 Webview 相关回归。
- 隔离临时目录中的真实跨进程配置租约交接；不使用用户配置和真实模型。
- 同步功能清单、运行时设计与 ontology，执行相应校验。

## 当前进展

- 已查本机错误日志，确认同一 Vibe Tab 释放超时随后获取超时；锁持有 PID 仍存活，不能安全强拆。
- 已确认 Webview 直接 dispatch，停止回调先发送 stopped 并删除运行条目，完整调用未被等待。
- 已实现 `PromptRunHandoff`：按 Tab 跟踪完整调用、取消准备中的旧调用、等待原生确认及失败后仍待释放的配置租约，90 秒超时后不迟到发送。
- Codex 等待 `turn/interrupt` 应答后复用现有原生会话交接；共享连接确认 `thread/closed` / `notLoaded`，专属连接等待实际进程退出，保留其它会话。
- Webview 依次显示“正在等待原任务完全暂停”“正在发送补充任务”“等待模型响应”并防重，停止失败保留输入与上下文；仅匹配请求的确认可清空仍未改写的输入，后台 Tab / 迟到消息有独立回归。目标 Tab 在消息到达前关闭时拒绝发送，不回退到其它活动 Tab。
- 功能清单、运行时设计、避坑指南及现有 ontology 规则已同步。经验已上提至 runbook，不重复写入 `ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md`，不引入新依赖、配置锁协议或发布动作。

## 验证结果

### 最终隔离构建与相关回归

共享工作区同时存在另一项 Loop+ 验收改动。为验证本次修复，在 HEAD `e890e363` 的 detached worktree 中仅复制本次文件，复用本机依赖：`/private/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-pause-verify-xmcnvpr8`。最终 18 个源码/测试文件 SHA-256 与实际工作区一致，比较结果：`/tmp/sinitek-pause-source-comparison.json`。

- `npm run build`：通过，日志 `/tmp/sinitek-pause-final-build.log`。
- 下列命令：417/417，通过；fail / cancelled / skipped / todo 均为 0，日志 `/tmp/sinitek-pause-final-focused-tests.log`。

```bash
node --test --test-reporter=tap \
  dist/test/extensionHost/promptRunHandoff.test.js \
  dist/test/extensionHost/promptSessionHealth.test.js \
  dist/test/config/sharedRuntimeConfig.test.js \
  dist/test/session/sessionMessageActionsCoreCoverage.test.js \
  dist/test/webview/loopPlusModeEntry.test.js \
  dist/test/webview/looppluswebviewintegration.test.js \
  dist/test/webview/clipagescriptruntimecoverage.test.js \
  dist/test/interactive/codexThreadHandoff.test.js \
  dist/test/interactive/manager.test.js
```

### Chromium 与原生进程

- 使用 `chromium-playwright-smoke` runner 渲染真实完整 Webview HTML，VS Code 消息桥及宿主确认由夹具模拟。等待、确认成功、停止失败三个场景全部通过；检查了输入/上下文保留、等待/发送/模型响应文案和提交次数，console / page / HTTP / request 错误均为 0，并检查三个截图。证据：`/tmp/sinitek-pause-browser/{pause-wait,pause-success,pause-failure}/result.json` 和各自 `success.png`；临时服务已停止，场景文件已从工作树移出。
- 隔离副本运行默认三轮 `python3 verify_mac.py --report /tmp/sinitek-pause-isolated-native/verification.json`：当时 1216/1216 必要回归、三轮 pool 交接及公共 runner 交接通过，三轮原进程退出交接 45/41/42ms，公共 runner 46ms；临时 HOME、进程、stdio 清理均确认。该阶段证据早于最后的中断应答等待优化，不冒充最终共享工作区验证。
- 最终版本额外执行真实执行中暂停：临时 HOME + 本机 HTTP 模拟模型挂起请求 → `stopAndRebuild()` → `waitForStopped()` → 恢复原 thread → 原 peer thread 继续。Codex 0.167.2 / macOS arm64，实际 `process/exit` 先于暂停确认，交接 106ms，清理确认通过。命令当时为 `node .tmp/pause-smoke/verify-native-pause.cjs --live --report /tmp/sinitek-pause-native-inflight-final.json`；夹具现保留在 `/tmp/sinitek-pause-evidence-fixtures/verify-native-pause.cjs`，日志 `/tmp/sinitek-pause-native-inflight-final.log`。未访问真实模型或用户会话。

### 实际共享工作区与静态校验

- 已从实际仓库串行运行默认三轮入口两次，由入口自行构建，均在构建阶段被并发 Loop+ 改动阻断，未进入原生验证：先是 `loopPlusDecisionStrategies.test.ts` 夹具缺少 `acknowledgeReports`，后是 `src/loopGroupChatPanelState.ts:369` 的 `LoopPlusPanelSeenAttempt.requiresAcceptance` 不存在。最后一次报告：`/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-pause-native-final-ybg92wk0/verification.json`，退出 1；695 个源码/测试/脚本指纹已记录开始与结束，期间三个其它 Loop+ 测试文件变化。本次文件与隔离副本的比较独立记录，不覆盖或修复并发任务。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9，通过。
- 本次文件的 `node scripts/check_trailing_whitespace.js <paths...>` 与 `git diff --check`：通过。

## 失败分流与覆盖边界

- 最后一次并行 Chromium 复核有一个浏览器停在 `browser.newContext`，未进入业务断言；已清理本任务的挂起浏览器并串行重跑通过。该次环境失败报告保留在 `/tmp/sinitek-pause-browser/pause-failure/browser-context-attempt.json`，不改产品实现或放宽页面错误检查。

- 首次执行中原生暂停等约 60 秒，旧版专属策略的实际退出断言失败；属于本次实现缺陷：`turn/interrupt` 请求尚未返回，错过专属退出路径。已增加 `pendingInterrupt` 等待及独立回归，最终真实进程测试通过。
- 旧 Webview 夹具仍断言点击即清空输入，属于契约变化后的断言过期；已改为原生暂停确认后才清空，并补失败保留、新输入和迟到回执回归。
- 实际共享工作区的 TypeScript 失败属于并发任务范围外失败。最终相关源码、隔离构建与真实暂停交接已验证；不能据此声称当前共享源码整体已构建通过。
- 其它窗口持续持有配置锁时，仍会明确拒绝启动；不删除存活宿主的 mutex。本次修复同一 Tab 提前重发的竞态，不保证消除所有跨窗口配置竞争。
- 未安装或重载当前扩展，未做真实 VS Code 图形宿主端到端、Windows 原生、其它 CLI 或真实模型任务验证；未运行全仓单测。

## 收口

本次修复范围完成，最终相关回归与隔离原生证据通过。实际共享工作区整体构建等待并发 Loop+ 任务自行收口；该限制已明确记录，不扩展本次修复范围。
