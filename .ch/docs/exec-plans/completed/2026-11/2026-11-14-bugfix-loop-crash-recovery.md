# Loop / Loop+ 宿主崩溃后的子任务回报恢复

- 日期：2026-11-14
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：无

## 背景与目标

VS Code 意外退出会丢失调度器和主任务等待者。Loop+ 完成通知只查询内存控制器；经典 Loop 子任务完成清空 active IDs 后，关闭标签触发的运行核对又可能将父任务标记停止，导致随后唤醒被拒绝。

目标是让手动续跑子任务的结果回到持久化父任务，并恢复原主任务协调；区分宿主中断与用户主动停止，保留其它未完成子任务的关联和真实状态。

## 范围与非目标

- 修复运行核对、子任务回报和冷恢复调度路径；增加真实磁盘持久化及重建 host 的回归。
- 同步产品清单、恢复设计及 ontology。
- 不变更 CLI 协议、框架或依赖，不发布扩展，不接管崩溃前的外部进程。

## 验收标准

- 运行核对保留活动子任务 ID；宿主中断与用户停止可区分。
- 经典 Loop 手动续跑成功后等待所有活动兄弟任务完成，再唤醒主任务；重复回报不重复启动主任务。
- Loop+ 没有内存控制器时，从有效快照恢复原 attempt 的完成事件、沟通记录和主任务验收，失去进程的兄弟任务保留待续跑状态。
- 用户主动停止、已完成任务、非法快照和已结束 attempt 不被完成回报意外复活。
- 构建与相关回归通过，记录真实磁盘恢复验证的边界。

## 影响面与风险

- 代码：loopTaskStore、loopGroupChat、promptRunRuntime、loopPlusOrchestration、extension 的完成通知装配。
- 风险：冷恢复时误将兄弟任务当作结束、重复回报或复活主动停止任务。以原 attempt、快照和中断标记控制准入；保留原验收门禁。
- 回滚：回退本次源码；新增可选持久化字段可由旧版本忽略。

## 验证计划

- npm run build
- 相关 node --test：宿主冷恢复、Loop+ 编排、子任务生命周期、群聊运行状态、任务存储和 sessionMessageActions。
- 用临时 HOME / 磁盘任务存储销毁并重建 host，验证完成事件和父任务恢复；不调用付费模型。
- ontology 校验及 Python 单测、git diff --check。

## 当前进展

Tasklist:
- [completed] 核对事实来源和完成回报断点
- [completed] 修复恢复路径并补充回归
- [completed] 构建、相关验证和事实来源同步
- [completed] 核对最终全量结果并归档

## 实现与决策

- 宿主运行核对不再把活动子任务 ID 当作存活证明；失联时持久化 `runtimeInterrupted=true`，保留子任务关联、Loop+ 快照及验收队列，running 子任务转 blocked。主动停止和显式续跑清除该标记。
- 经典 Loop 继续复用完成清理；全部活动子任务完成后恢复中断父任务。父任务唤醒互斥防止重复启动，只跳过已回报且不再活动的重复完成，后续活动子任务仍能正常回报。
- Loop+ 冷完成通知从有效持久化快照重建控制器，沿用原开放 attempt ID；其余失联预留保持 blocked，不伪造 stopped 结果。先注册所有权再发布 running，先成功回报再关子任务 Tab。
- 主动停止、已完成、失败限制、非法快照或已关闭 attempt 均拒绝自动恢复。旧版 stopped 且无中断原因的记录仍需显式继续父任务，避免猜测用户停止意图。

## 测试与清单同步

- 新增/更新测试：`loopCrashRecovery.test.ts`（9 项，磁盘恢复、真实子进程强制退出、兄弟任务、防重及拒绝路径）、`loopPlusRuntimeIntegration.test.ts`（冷完成回报至父任务验收完成）、`loopGroupChat.test.ts`（活动 ID 不证明进程存活）；同步接线断言与运行时夹具。
- 构建：`npm run build` 通过。
- 相关回归：下面命令通过，264 项通过、0 失败、0 跳过。

```sh
node --test \
  dist/test/extensionHost/loopPlusEntryRouting.test.js \
  dist/test/extensionHost/loopCrashRecovery.test.js \
  dist/test/extensionHost/loopPlusOrchestration.test.js \
  dist/test/extensionHost/loopPlusRuntimeIntegration.test.js \
  dist/test/extensionHost/loopPlusRuntimeWiring.test.js \
  dist/test/extensionHost/loopModelSwitchResume.test.js \
  dist/test/loop/loopSubtaskLifecycle.test.js \
  dist/test/loop/loopGroupChat.test.js \
  dist/test/loop/loopTaskStore.test.js \
  dist/test/session/sessionMessageActions.test.js
```

- 全量：`node scripts/run_unit_tests.js` 最终 4151 项中 4134 通过、14 失败、3 跳过，剩余失败全部在未修改 HEAD 独立复现。本次改变的关页/回报顺序曾导致 1 条静态断言过期，已更新为回报成功后关页，并保留拒绝时不关页检查，最终全量与相关回归均未再出现该失败。
- 历史/环境失败基线：独立临时目录中 `git archive HEAD`、复用 `node_modules`、构建后运行以下 6 个失败文件，49 项中 35 通过、14 失败，与当前剩余失败一致。`loopPlusEntryRouting` 在基线通过。
  - `config/cliGlobalSkills`：1 项，macOS 临时 Unix socket 路径过长导致 `listen EINVAL`，环境问题。
  - `extensionHost/taskCompletionAttentionHost`：3 项，VM 夹具缺少 `taskRunCompletionEmitter`，历史夹具问题。
  - `loop/loopPlusGroupChatPanel`：5 项，计数、阶段和验收文案断言过期，历史断言问题。
  - `shared/workspaceScaffoldSkillPaths`：3 项，仍预期七种执行计划类型，与现行四类型规则不符，历史断言问题。
  - `webview/looppluswebviewintegration`：2 项，VM 夹具缺少 `retainChatBubbleEntries`，历史夹具问题。
- 结构检查：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9 项通过；修改范围 trailing whitespace 校验与 `git diff --check` 通过。
- 最小本机验证：单测另起独立 Node 进程写入真实磁盘任务记录，强制 `SIGKILL` 后重建宿主，原 attempt 结果成功回报且兄弟任务保留 blocked；真实运行时适配器使用脚本模型验证恢复后的验收、报告、原主模型配置及父任务 completed。未执行 VS Code 图形宿主崩溃、真实付费模型或 Windows 本机验收；无 Webview 代码变更，不需浏览器布局验证。
- 功能清单及事实来源：已同步 `FEATURE_INVENTORY.md`、能力清单、`ARCHITECTURE.md`、恢复设计、Loop+ 调度设计、停止排障 runbook 及 ontology；稳定设计入口为 `.ch/docs/design-docs/loop-crash-recovery.md`。
- 记忆判断：稳定结论写入恢复设计；无需增加通用热区条目。

## 当前结论

恢复逻辑、回归、事实来源同步与失败分类均已完成。更新后的扩展加载后生效；本次没有安装、发布或启动用户现有任务。全量仍保留上述 14 项基线失败，未扩大范围修改。图形宿主真实崩溃及 Windows 本机验证为本次证据边界，已在设计和清单中明示。
