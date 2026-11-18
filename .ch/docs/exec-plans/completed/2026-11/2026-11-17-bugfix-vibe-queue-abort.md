# Vibe 完成后队列任务被旧压缩中止

- 日期：2026-11-17
- 类型：bugfix
- 关联计划：无；工作区已有 Loop+ 显式依赖与轮次配置任务，本修复独立推进。
- 状态：completed
- 负责人：Codex
- owner：vibe-queue-abort

## 背景与目标

用户报告 Vibe 完成后，排队任务在建立 Codex 连接前失败。只读本机记录确认：上一任务完成后约 0.7 秒发送队列任务，紧接着出现停止提示，约 31 秒后 AbortError。成功收尾会在发送 end 后启动自动压缩，新请求会抢占该压缩；压缩的异步准备及迟到停止必须受调用所有权约束。

目标：消除正常完成、自动压缩与队列继续之间的竞态，旧压缩取消后不能影响新任务。

## 范围与影响面

- 核对 `promptInteractiveRuntime`、`contextCompactionRunner`、`PromptRunHandoff` 和 Codex runner 的当前调用链；修改根因处及对应测试。
- 隔离目录 `/tmp/sinitek-vibe-queue-abort-20261117`，独立 dist 构建；保留主工作区已有修改。
- 同步功能清单、运行时文档及必要的 ontology/runbook。
- 非目标：执行用户用来定位的轮次调整提示词、变更框架/依赖、发布或重放真实任务。

## 验收标准

- 回归覆盖旧压缩在异步准备中被停止，随后相同会话新请求成功，旧回调不再获取或中止新 runner。
- 正常队列交接保持串行，压缩相关状态不会触发重复或提前发送。
- 主动停止、压缩失败与超时仍能收尾，Loop 主子任务既有交接保持兼容。
- 最小相关测试与 `npm run build` 通过；记录本机验证边界。

## 风险与缓解

风险：压缩承担运行状态和队列唤醒职责；只隐藏错误或扩大重试会掩盖所有权缺陷。用可控异步屏障稳定复现，验证成功、停止、超时、迟到回调及同会话替换。

## 验证计划与记录

- 最小单测：`node --test dist/test/core/contextCompactionRunner.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js`，按影响扩展交接与队列测试。
- 构建：隔离目录执行 `npm run build`；构建和读取 dist 的测试串行。
- 运行时：只读核对实际安装扩展日志；复用项目隔离本机 Codex/模拟模型验证入口（按最终改动确定）。
- 修改前已稳定复现 3 个回归失败：压缩前 end 放行队列（运行/跳过两路径），及取消后的配置读取重新获取 runner。
- 主工作区及隔离目录的 7 文件 173/173 单测均通过，覆盖交互与 OpenCode 共用模板的完成/跳过/停止、原生压缩取消、Loop 主子任务原交接。命令：`node --test dist/test/core/contextCompactionRunner.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/openCodePromptRunTemplate.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js dist/test/loop/loopSubtaskAutoCompact.test.js dist/test/loop/loopMainAutoCompact.test.js`。
- 主工作区 `python3 verify_mac.py --report /tmp/vibe-queue-abort-native-report.json`：构建通过，1348 项回归中 1347 通过；范围外 `loopPlusPromptBuilders` 的冻结批次用例仍断言 `Subtask round limit: 100`。检测期间 `src/loopPlusScheduler.ts` 被并行修改，702 文件指纹核对发现该项变化，本次统一结果作废，未进入原生交接阶段。
- 隔离目录执行 `python3 verify_mac.py --report /tmp/vibe-queue-abort-isolated-native-report.json` 通过：构建通过，1306/1306 回归通过（无跳过或取消），三轮真实 Codex pool 交接及一轮公共 runner 交接通过。同会话恢复、其它会话保留、原进程退出、stdio 关闭和临时目录清理均已确认。隔离源码 diff 与检测前保存补丁一致，不受主目录其它任务影响。
- 报告为 `passed=true`、`fullyVerified=false`：本次验证平台为 macOS arm64；未验证已安装扩展、真实模型完整任务、Windows、其它 CLI 或全仓所有单测。源码修复已同步主工作区，当前已安装扩展尚未更新。
- ontology 结构校验及 9/9 单测通过，`git diff --check` 通过。
- 功能清单、运行时参考、PITFALLS 和 ontology 已同步；不重复向记忆热区追加同一事件。

## 交付结果

普通 Vibe 在需要自动压缩时延迟完成通知，压缩结束后才放行队列；压缩跳过时仍正常发布一次完成通知，主动停止时保持队列暂停。压缩异步准备及迟到回调检查原运行身份，防止取消后的旧操作获取或中止下一任务的 runner。交互、one-shot 和并行执行入口均已覆盖，Loop 主子任务原有交接行为保留。

源码和文档已完成并纳入本任务独立提交；未发布或安装扩展，需运行或安装包含本修复的新构建后才会影响当前 VS Code。

## 当前进展

Tasklist:
- [completed] 复现 Vibe 自动压缩与队列交接竞态
- [completed] 修复所有权与取消检查并验证回归
- [completed] 同步文档、完成本机验证并归档
