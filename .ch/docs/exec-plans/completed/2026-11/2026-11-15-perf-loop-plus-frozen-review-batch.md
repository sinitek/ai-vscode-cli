# Loop+ 冻结验收批次

- 日期：2026-11-15
- 类型：perf
- 关联计划：[Loop+ attempt 身份交接](2026-11-15-bugfix-loop-plus-attempt-identity-handoff.md)；共同交付用户所选第 3、4 项优化。本计划负责冻结验收与投影，生命周期身份由关联计划负责；共用集成证据及最终 Git 收尾，各自维护验收和真实状态。
- 状态：completed（冻结行为与群聊投影已验收；真实宿主身份检查、失败修复及文档审阅已接受，实施提交已推送并核对远端）
- 负责人：fullstack 独立执行 attempt

## 背景与目标

移除后到完成事件引发的中止、丢弃答案及扩批重问。启动 review 时冻结有序 eventIds 和用户消息前缀，第一条完成立即验收，其它子任务继续执行，无全局 batch barrier。

## 范围与非目标

修改 orchestration、必要策略及测试、调度和群聊状态设计文档，并通过宿主只读 eventId 查询接线群聊投影。复用 scheduler.submitReviewBatch 的 currentReview + FIFO 前缀提交。保留停止、generation、acceptancePlanEpoch、完成和额度保护；不改生命周期、冲突策略、持久化容错和其它门禁。不运行发布脚本。

## 验收标准

- [x] A 验收期间 B 完成不 abort、不扩批、不重问；A 一次确认，B 按 FIFO 下一批处理，第一完成立即验收、其它任务并行，无共享 round gate。
- [x] 多 ID 顺序及提示词刷新不扩大；失败、协议修复、同宿主暂停恢复保留未确认批次。
- [x] completed 提交本批后按最新开放状态保护；消息只消费捕获前缀；额度按新确认 attempt 计数、不重复计数。
- [x] 当前冻结请求的验收方案 epoch、generation 和停止保护保留有效；不据此宣称身份/通知/压缩的跨任务组合已验收。
- [x] 实现 blocked 后到消息推进与冻结批次只读群聊投影，更新调度与状态边界文档。
- [x] round-9 宿主失败修复后，持锁构建、七文件 238 项测试及差异检查通过；投影更新后三文件 34 项及各自构建、差异检查通过。
- [x] 生命周期生产接线与相关单测已落地；round-16 同步其共享事实及阶段证据。
- [x] 真实 Extension Development Host 身份检查通过并获主审接受；不扩大为群聊浏览器或所有调度交错已验证。
- [x] 全量测试已执行，原 46 项失败逐项定向修复并获主审接受；保留原统计，不拼接为新全量全绿结果。
- [x] round-24 五份文档最终差异已获主任务审阅接受。
- [x] 已审阅实施提交已正常推送并核对远端；实际结果见下方 Git 交付记录。

## 影响面、风险与缓解

仅保存当前批次 MainStep 元数据，事件仍由 scheduler 持有，不建立新事件队列。写前重读，保留并发修改；复核前缀提交和 latest-state 完成保护。群聊只读批次元数据由宿主副本查询，无持久化或 UI 状态机。

## 验证计划

按 .ch/docs/TESTING.md，以 Node fs.mkdir 原子获取 os.tmpdir()/sinitek-loop-plus-msg_1794684101461_8c456617d055-verification.lock；一次持锁 npm run build 后执行相关 node --test，finally 释放，不删除他人锁。可控 Promise 及 setImmediate 排空验证交错，不任意 sleep。已完成的宿主身份和 Codex 组合验证见关联计划；真实 CLI、完整视觉及其它未测交错仍不在这些证据范围。本轮只检查更新的文档与引用，不重跑已有有效验证。

## 测试与清单同步

- 回归：冻结批次、FIFO、顺序、重试、消息、完成、额度、方案变更和停止。
- 历史结果：round-6 持锁 `npm run build` 通过；7 个相关测试文件共 256 项中 248 通过、8 失败；`git diff --check` 通过。round-7 报告留存的 round-5 日志为 256 项中 247 通过、9 失败，但与后续源码不同，只用于定位旧断言，不能视为当前验证。
- 已核对的有效证据（复用，不重跑 Node 构建或测试）：
  - 宿主 `round-9-repair-frozen-review-completion-round4.md`：持锁 `npm run build` 通过；`node --test --test-reporter=dot dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopGroupChatPanelState.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopPlusGroupChatPanel.test.js`，七文件 238 项全部通过；`git diff --check` 通过。
  - 群聊 `round-9-repair-group-chat-review-projection-round2.md`：投影更新后持锁 `npm run build` 通过；`node --test --test-reporter=spec dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopGroupChatPanelState.test.js dist/test/loop/loopPlusGroupChatPanel.test.js`，三文件 34 项通过、0 失败；`git diff --check` 通过。
  - 以上证据覆盖各报告声明的冻结/FIFO/消息/策略与投影/呈现范围；不替代跨任务集成、真实 CLI、浏览器或最终全量测试。后续身份/通知/压缩改动应另行判断既有结果是否仍覆盖，不能把旧结果当作新增组合通过。
- 历史失败与 round-9 修复：前序 accept 夹具的 `repair` 未关联 `reviews[].subtaskIds`，群聊夹具把全部 FIFO 队列当成冻结批次，并引用旧计数/文案；这些已按当前契约修正，策略 mock 同步 `persistSnapshot` 顺序。round-9 最终修复 blocked 无后续消息快捷分支未消费已见前缀的问题，同步扣除 held review 的消息计数，并将断言限定在 New user messages 区段。逐事件 accept、completed 前缀、in-flight prompt refresh 等现有用例纳入七文件 238 项通过结果；不扩大为所有交错组合均已验证。
- 群聊接线：当前已通过宿主只读冻结 eventId 前缀输入投影，按 FIFO 前缀校验后区分验收中与等待验收；没有有效元数据时回退为等待验收。UI 使用既有成员状态和摘要文案，不增加状态机。
- 功能清单与 ontology：round-12 文档任务已保留式同步冻结行为、群聊投影及已验收身份基础设施；保留稳定规则 ID 和原 source_refs。round-16 同步生命周期接线与相关单测，当时真实宿主及全量门禁未完成；round-24 更新其后通过的宿主身份检查与原全量失败修复闭环，文档最终审阅和 Git 交付仍待完成。
- 后续验证闭环：原全量 4,221 项（4,172 通过、46 失败、3 跳过）及 Python 88 通过、1 跳过已执行；六项定向修复覆盖原全部 46 项失败并获主审接受。最新 socket 轮构建覆盖全部源码修复，其后无源码修改；没有新全量全绿运行。宿主身份检查、六项修复报告与各自计数见[身份计划验证收口](2026-11-15-bugfix-loop-plus-attempt-identity-handoff.md)，不累加与原套件重叠的通过或跳过数，也不把宿主身份验证代替群聊浏览器验证。
- 文档：更新 loop-plus-scheduling.md，保留并发修改。

## Tasklist

- [completed] 查证与冻结实现
- [completed] 稳定回归与提示词、设计契约
- [completed] round-9 修复相关失败并通过七文件 238 项、投影三文件 34 项验证
- [completed] round-12 同步产品清单、ontology 与本计划阶段结论
- [completed] round-16 同步生命周期接线与相关单测落地事实
- [completed] 真实宿主身份补验及原全量 46 项失败定向修复获主审接受
- [completed] 主任务最终审阅 round-24 文档并接受
- [completed] 明确暂存 52 个已审阅文件，检查暂存差异，提交推送并核对远端
- [completed] 实施提交远端确认后标记 completed，归档至 completed/2026-11/，同步双方互链及仓库引用并核对目标

## 决策记录

- memory-recall focus=Loop+ acceptance FIFO batch scheduling，anchor 为空，输出隔离至 /tmp/loop-plus-frozen-review-recall，避免覆盖共享 generated。仅命中 baseline/stale 热区；进一步核对 ontology source_refs 和当前源码。
- ontology status=ready；CodeGraph 优先查证，orchestration 索引 stale 后直接读当前源码。
- scheduler 已支持原子消费前缀，applyCompletedDecision 已提交后检查最新状态，不重建状态机。

## 当前结论

第 4 项冻结验收行为及只读群聊投影已落地并经主任务源码审阅，round-9 的 238/34 项结果可复用；两组范围重叠，不相加为独立测试总数。blocked 只消费已见消息，后到消息由下一次有界决策捕获，无新消息最终暂停；completed 确认本批后仍受最新开放状态门禁约束。群聊仅将宿主副本中通过 FIFO 前缀校验的冻结成员标为正在验收，后续成员保留既有待验收文案与完整队列计数；暂停、停止、释放或元数据无效时不以整队列替代活动批次，classic 和视觉设计不变。

第 3 项生命周期生产接线及 186/186、14/14、2/2 等相关结果按原范围有效，不能将本计划原 238/34 项计作新生命周期证据。真实 Extension Development Host 身份检查已通过并获接受；原全量已执行，其 46 项失败全部经定向修复、验证与主审闭环，保留原失败统计，不声称另跑全量全绿或完整 UI/真实 CLI 已验证。证据与边界见关联身份计划。round-24 五份文档的最终差异已获主任务审阅接受，生产、测试与宿主验证交付亦已审阅。实施提交 `1b3dfb1f1ce68da4d09fb1c7f38764b2f2710958` 已正常推送至现有上游 `origin/master` 并核对远端一致。两项优化的实施交付已完成，本计划标记 completed 并归档至 completed/2026-11/，双方互链及仓库引用同步；归档收尾提交的最终哈希与推送核对结果另记 round-25 报告，不通过自引用循环追加提交。

## Git 交付与归档（round-25）

- 分支 `master`，沿用既有上游 `origin/master` 和现有 Git 身份；实施提交 `1b3dfb1f1ce68da4d09fb1c7f38764b2f2710958`（52 个已审阅文件）已通过 `git push origin HEAD:refs/heads/master` 正常推送，退出 0。
- 推送后 `git ls-remote --exit-code origin refs/heads/master`、本地 HEAD 与 `refs/remotes/origin/master` 均为 `1b3dfb1f1ce68da4d09fb1c7f38764b2f2710958`；实施提交后工作区与索引干净。
- 文档最终审阅已获接受，计划按日期归档至 `.ch/docs/exec-plans/completed/2026-11/`，与[身份交接计划](2026-11-15-bugfix-loop-plus-attempt-identity-handoff.md)保持互链，并同步会话设计、功能清单和 ontology 阶段状态。
- 归档移动后的相对链接、仓库具体引用、状态/月份、文档空白、ontology 数据及暂存差异按本轮最小范围检查；不重跑已有有效运行验证。归档收尾单独提交推送，最终哈希、实际推送与远端核对结果由 `round-25-loop-plus-final-git-delivery.md` 报告记录，本文件不预写该次推送结果。
