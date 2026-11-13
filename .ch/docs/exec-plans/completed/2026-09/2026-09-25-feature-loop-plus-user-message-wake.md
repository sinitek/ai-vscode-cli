# Loop+ 用户消息唤醒主任务 — 新功能开发

- 日期：2026-09-25
- 状态：completed
- 负责人：Codex
- owner：loop-plus-user-message-wake
- claimed_at：2026-09-25
- claim_ttl：本次实现与相关单测完成
- 类型：feature


### 背景

Loop+ 群聊的“我要说话”此前只把文本写入 `supplementalRequirements` 和沟通文件。主任务只在子任务完成形成验收项时被唤醒，用户消息要等到下一次无关唤醒才会出现在提示词里。

### 目标

- Loop+ 提交“我要说话”后，主任务空闲就立即唤醒。
- 主任务当前正在执行时，消息进入调度快照队列，不并行再开一个主任务。
- 当前主任务返回后，下一轮一起查看这次积压的全部消息。
- 主任务必须在 `dispatch` 和 `wait` 之间判断：能立刻做就派发子任务；需要某个仍在运行或待启动的子任务结束后再发起时，选择等待。
- 经典 Loop 的“我要说话”仍只保存补充需求，不走这条队列。

### 范围

- `src/loopPlusScheduler.ts` 持久化 `userMessageQueue`。
- `src/extensionHost/loopPlusOrchestration.ts` 唤醒、入队和确认已查看消息。
- `src/extensionHost/loopPlusPromptBuilders.ts` 把同一批消息交给主任务，并写明派发或等待。
- `src/panelDiagnostics.ts` 与 `src/extension.ts` 只对 `event_driven` 转发。
- 中英文帮助和系统提示。

### 非目标

- 不改变经典 Loop、Vibe 的补充消息语义。
- 不把用户消息混进验收队列，也不让模型直接改调度状态。
- 不在父任务已停止、已完成或主任务连续失败达到上限时自动重启。
- 不把 Loop+ 写成已经整体上线，因此不改 `FEATURE_INVENTORY.md` 和能力总表。

### 验收标准

- [x] 主任务执行中连续提交的多条消息，在当前调用结束后由同一次主任务查看。
- [x] 主任务空闲且仍有在途子任务时，新消息会单独唤醒一次主任务。
- [x] 主任务可以选择立刻 `dispatch`，或在仍有在途工作时 `wait` 且不新开子任务。
- [x] 未见过的用户消息会阻止父任务完成。
- [x] 旧快照没有 `userMessageQueue` 时仍能加载为空队列。
- [x] 经典 Loop 提交“我要说话”不会调用 Loop+ 通知。

### 影响面

- 代码目录：`src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/panelDiagnostics.ts`、`src/extension.ts`、`src/i18n.ts`、`src/webview/viewContentI18n.ts`
- 配置与脚本：无

### 风险与缓解

- 风险：用户消息被当成验收确认。缓解：单独的 `user` 步骤不持有 `reviewEventId`，`wait` 和 `dispatch` 都不能携带它。
- 风险：执行中的主任务提示词被后到消息改写。缓解：入队只影响下一次构建的提示词；已查看条数按本轮开始时的前缀确认。
- 风险：旧快照被新字段判为损坏。缓解：缺字段读成空数组，非法数组仍拒绝。

### 任务列表

- [x] 调度器保存用户消息队列
- [x] 宿主唤醒或入队
- [x] 主任务提示词要求判断派发或等待

### 决策记录

- 2026-09-25：用户消息队列与验收队列分开。当前验收先完成，再看积压的用户消息，然后才领取下一条验收。已停止、已完成或主任务失败达上限时不自动唤醒。

### 当前结论

已实现。Loop+“我要说话”会在主任务空闲时唤醒；主任务执行中则进入 `userMessageQueue`，当前调用结束后一起查看。主任务用 `dispatch` 立刻发起子任务，或在仍有在途工作时 `wait`。经典 Loop 不变。功能清单未改，因为 Loop+ 整体仍未作为已上线能力写入清单。

## 分类依据与真实状态

feature：未整体上线的Loop+新增消息唤醒语义；test：队列与跨模块回归实际开发；docs：设计/ontology实际更新。102项Node、9项ontology为原结果，未整体上线和禁止自动重启终态保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
