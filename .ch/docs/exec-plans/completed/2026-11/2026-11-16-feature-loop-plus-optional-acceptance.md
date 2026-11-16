# Loop+ 子任务可选验收

- 日期：2026-11-16
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

当前 Loop+ 所有子任务完成后都进入完整验收。增加由主任务在派发时决定的 `requiresAcceptance` 标记；无需验收的结果直接显示“无需验收”，仍可靠唤醒主任务，供其读取报告并继续派发或收尾。测试只是参考例子，判断依据应为结果可直接核对、范围与风险以及独立复核要求，不以任务类型或复杂度一刀切。

## 范围与非目标

覆盖派发协议、任务持久化、调度器、恢复与主任务唤醒、群聊状态、提示规则及相关文档；保留经典 Loop、既有需验收事件的 FIFO/冻结批次及最终完成门禁，不改变技术栈。

## 验收标准

- 主任务可明确设置 `requiresAcceptance: false`；缺失按原行为需要验收，非法类型拒绝。
- 无需验收的完成结果进入独立报告通知，不进入验收队列，不产生成功验收记录或验收次数。
- 主任务读取已冻结的报告后继续执行；晚到、暂停或宿主恢复后的报告不丢失，未处理报告阻止最终完成。
- 群聊完成成员显示“无需验收”，运行失败和中断保持真实状态。
- 提供通用判断规则及多个例子，保留用户或项目明确要求的验证与独立复核。

## 影响面与风险

- 代码：`src/loopPlusScheduler.ts`、`src/loopPlusDecision.ts`、`src/loopTaskStore.ts`、Loop+ 宿主、群聊投影与渲染。
- 文档：Loop+ 调度设计、功能清单、运行时 ontology。
- 风险：报告通知若只瞬时唤醒会在忙碌、暂停或恢复时丢失。缓解：报告队列持久化、冻结请求可见前缀、只在有效决策时确认，并纳入完成门禁。
- 回滚：取消显式 false 的派发，缺省继续原验收流程；旧快照默认空报告队列。

## 验证计划

- 构建：`npm run build`。
- 单元自测：`node --test dist/test/loop/loopPlusScheduler.test.js dist/test/loop/loopPlusDecision.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopGroupChatPanelState.test.js dist/test/loop/loopTaskStore.test.js dist/test/core/promptRunCompletionText.test.js`。
- 本机最终验证：实际仓库串行执行 `python3 verify_mac.py --report <全新临时目录>/verification.json`，默认三轮，由入口构建；Windows 需原生另机验证。
- ontology 与格式：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、`git diff --check`。
- 群聊状态是纯 HTML 投影与主题语义类变化，无新的交互或布局行为；由群聊 HTML 渲染测试覆盖，不需要额外 headless Chromium 检查。

## 测试与清单同步

- 单元测试：更新派发标记解析、调度报告 FIFO/恢复/完成门禁、主任务报告唤醒/冻结前缀/冷恢复、提示规则与群聊中性状态。
- 自测结果：`npm run build` 通过；上述 9 个相关测试文件 302/302 通过；ontology 校验通过（142 条规则）且 ontology 自测 9/9；`git diff --check` 通过。本机最终默认三轮验证退出 0，72 个必要回归文件 1230/1230 通过，无失败、跳过、取消或 TODO；699 个源码/测试/脚本文件前后指纹一致。
- 失败处理记录：首次构建发现策略端口测试 mock 漏增报告确认接口，已补齐；首轮回归暴露报告事件测试未使用宿主生成的真实 attempt ID，以及提示示例断言未更新，已按新协议修正。收尾审阅额外发现免验收失败/停止的快照恢复校验错误（实现缺陷）、reprompt 缺省继承旧免验收（实现缺陷），均已修正并补 round-trip 与宿主回归。另补报告/用户消息前缀、blocked 复核报告只确认一次、持久化标记、协议示例携带报告 ID 和完成文案回归；相关测试全绿。
- 功能清单、设计与 ontology：已同步 `FEATURE_INVENTORY.md`、Loop+ 调度设计及 runtime ontology 规则。
- 记忆判断：稳定规则进入设计/规格和 ontology，不写自动滚动摘要。

## 任务列表

- [x] 派发、持久化、调度与恢复支持逐 attempt 的免验收标记和报告队列。
- [x] 主任务提示、报告确认协议、成功唤醒和完成门禁保持一致。
- [x] 群聊展示、通用判断规则、简单任务直办规则与产品事实来源已同步。
- [x] 运行构建、相关回归、ontology 与差异格式检查。
- [x] 完成实际仓库默认三轮本机验证，记录证据并归档。

## 当前进展

- 已完成入口规则、bounded recall、ontology 与 CodeGraph 调用链核对；召回 anchor 为空，无关联活动计划。
- 核心实现与边界修正均完成。已修正免验收失败/停止 attempt 的恢复校验、reprompt 缺省标记、完成文案及报告消息门禁，相关 302 项回归通过。
- 已完成默认三轮本机验证与证据核对，计划归档；无未决实现问题。

## 本机最终验证证据

- 命令：`python3 verify_mac.py --report /var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/loop-plus-optional-final-aulicrmz/verification.json`，默认三轮，从实际仓库串行执行；该入口构建，无额外预热构建。
- 环境：macOS arm64，Node v24.22.2，PATH Codex 0.167.2，源码版本 1.9.10，commit `e890e36352570b6cda9fc531df06ca2007a09ec6`，dirty=true。
- 必要回归：72 个文件，1230/1230，失败/取消/跳过/TODO 均为 0；五项存储/交接/完成门禁均实际执行。相关 9 文件 302/302 的日志也保留在同一报告目录。
- 三轮 pool 交接耗时：47 / 43 / 44 ms；均确认同会话恢复、其它会话保留、原进程实际退出。公共 runner 交接和四组进程/stdio/临时目录清理均通过。
- 文件指纹：`/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/loop-plus-optional-final-aulicrmz/source-fingerprint.json`，开始/结束均 699 个源码、测试和脚本文件，变化清单为空。最后只更新文档与计划，不改变已验证源码。
- 报告：`/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/loop-plus-optional-final-aulicrmz/verification.json`、`verification.log`、`verification.runner.json`，`passed=true`、`fullyVerified=false`。前一轮同样通过，最终轮补齐前后指纹留证。
- 覆盖边界：未执行 Windows 原生验证、已安装扩展/真实图形宿主端到端、真实模型完整任务或全仓单测；群聊标签由投影和 HTML 渲染回归覆盖，未运行 headless Chromium。未安装或发布扩展。
