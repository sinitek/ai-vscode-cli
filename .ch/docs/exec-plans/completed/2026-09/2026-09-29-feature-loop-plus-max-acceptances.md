# Loop+ 最多验收次数 — 新功能开发

- 日期：2026-09-29
- 状态：completed
- 负责人：Codex
- owner：loop-plus-max-acceptances
- claimed_at：2026-09-29
- claim_ttl：已完成
- 类型：feature


### 背景

经典 Loop 的 `loopMaxRounds` 不约束 Loop+。Loop+ 需要单独的验收次数上限，避免事件驱动验收无限继续。

### 目标

在“AI任务配置”增加 Loop+ 最多验收次数，默认 100，允许范围 1–999，并在宿主调度中强制执行。

### 范围

- 全局工具设置、面板状态、Webview 数字输入和中英文文案。
- Loop+ 任务记录保存该上限；已有任务只升不降。
- 一次成功确认的子任务 attempt 计 1 次。整批确认若会超过上限，则不提交，父任务进入 `needs-review`，验收队列保持不变。
- 已达上限后不再派发新子任务。没有新验收事件时仍可完成父任务。

### 非目标

- 不改变经典 Loop 最大轮次。
- 不改变 Loop+ 单次派发子任务上限或同时运行上限。
- 不把内部 200 次主决策安全上限改成这个设置。

### 验收标准

- [x] 设置默认 100，小于 1 归 1，大于 999 归 999，写入 `~/.sinitek_cli/settings.json`。
- [x] 超限批次不被确认，队列保留，任务进入 `needs-review`。
- [x] 提高上限并继续后，可以验收原先排队的项。
- [x] 达到上限后，带新子任务的 dispatch 不会启动新 attempt。

### 影响面

- 代码目录：`src/loopPlusDecision.ts`、`src/loopTaskStore.ts`、`src/toolSettings.ts`、`src/extensionHost/`、`src/webview/`、`src/extension.ts`、`src/i18n.ts`
- 配置与脚本：无

### 风险与缓解

- 风险：把一批多事件拆开确认会破坏 Loop+ 批次协议。
- 缓解：整批放不下就整批拒绝，不部分确认。

### 任务列表

- [x] 确认计数单位和配置入口
- [x] 接入设置、记录和界面
- [x] 调度强制执行

### 决策记录

- 2026-09-29：一次验收等于一个 `seenAttempts` 中新变为 `reviewed` 的 attempt。幂等重放不计。`loopPlusMaxAcceptances` 跟随任务记录，全局设置只升不降。

### 当前结论

已实现并归档。Loop+ 最多验收次数在“AI任务配置”中设置，字段 `loopPlusMaxAcceptances`，默认 100，范围 1–999，写入 `~/.sinitek_cli/settings.json`。它不读取经典 Loop 的 `loopMaxRounds`。一次验收等于一个新变为 `reviewed` 的子任务 attempt；整批超限则不提交，父任务进入 `needs-review`，验收队列保持不变。已达上限后不再派发新子任务。新建任务写入当时全局值，之后全局设置只升不降。

## 分类依据与真实状态

feature：新增独立验收设置与强制策略；test：多模块回归明确实际开发；docs：清单/能力/参考/设计/本体实际更新。保留69/69、42/42、1/1及Webview boots任务列表block/none既有失败，不将定向通过写成全套通过。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
