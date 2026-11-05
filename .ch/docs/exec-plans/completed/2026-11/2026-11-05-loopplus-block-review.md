# Loop+ 有限阻塞复核与分层完成提示

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex

## 目标与背景

针对局部业务路径受阻被升级为全局暂停，以及单次调用结束文案被误解为全部任务完成这两个问题，增加有限的剩余工作复核、可恢复状态和清晰的分层提示。保持既有安全、验收和授权边界，不保证消除真实外部阻塞。

## 范围与非目标

- 范围：Loop+ 编排与提示协议、任务存储、单次调用结束文案、主聊天及沟通文件中的暂停证据、群聊暂停展示与回归测试。
- 隔离：在 detached worktree 基于已有差异快照开发，只用本次增量整合回主目录；主目录已有通知设置与前后台提醒行为保持不变。
- 非目标：修改真实任务记录、自动恢复正在执行的用户任务、移除业务门禁、改写 scheduler、升级依赖、提交 Git 或发布插件。
- 隐私：只使用合成任务做测试，不将真实日志、用户配置、会话正文或私有数据写入仓库。

## 验收标准

- 首次全局 `blocked` 明确追加一次剩余工作复核；可独立且安全的工作继续派发，否则复核后才暂停。
- 无新进展或新输入时不重复复核；`loopPlusBlockReview` 保存待复核/已复核，兼容旧任务、宿主重建和显式继续。
- 新的用户输入（包括宿主未恢复时的持久化队列）、成功派发与验收提交可重新开启复核。
- 活动 attempt、错峰启动预留及验收事件不被复核确认、丢弃或重复消费；继续沿用协议重试与总决策次数上限。
- 暂停原因和恢复条件进入主聊天、主任务沟通文件与群聊 transcript；重复记录去重，聊天写入失败不阻断文件留证。
- 持久化去重标记不进入群聊可见正文；暂停不显示父任务全部完成。
- Loop+ 主任务单次调用显示调度结束，子任务显示等待验收；父任务持久化完成后才提示全部完成。
- 普通对话、经典 Loop 与现有通知设置行为保持兼容。

## 实现与影响面

- `src/extensionHost/loopPlusOrchestration.ts`：有界复核、进展/新输入重置、跨重建恢复和暂停异常隔离。
- `src/extensionHost/loopPlusPromptBuilders.ts`：逐项核对未完成根需求、补充需求、独立工作及恢复条件，不放宽门禁。
- `src/loopTaskStore.ts`：新增可选复核状态并丢弃非法状态，不改旧任务的必要字段。
- `src/loopPlusPause.ts`、`src/loopGroupChat.ts`：暂停文本、双文件幂等留证和仅展示时隐藏元数据。
- `src/promptRunState.ts`、`src/extension.ts`、两类 prompt runtime：把运行记录传入文案构建，区分调用、子任务和父任务完成。
- 文档：产品规格、功能清单、调度设计、排障指南及两条 Ontology 规则同步；根级架构边界不变，无需扩写 `ARCHITECTURE.md`。

## 风险与缓解

- 额外调用成本：每个无进展阶段仅追加一次复核，继续受既有安全与重试额度约束。
- 并发完成/消息：保留捕获的验收事件与队列前缀，不抢先确认；错峰任务暂停与继续沿用既有 scheduler 接口。
- 兼容与回滚：状态字段可选，旧任务不补造状态；回滚应只撤销本功能差异，不修改用户运行数据或通知设置。
- 路径：使用现有沟通目录和 Node 路径 API，不引入平台专属路径或命令。

## 验证记录

- `npm run build`：已通过；构建与读取 `dist/` 的测试严格串行。
- 最小相关回归：`node --test dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/loop/loopTaskStore.test.js dist/test/core/promptRunCompletionText.test.js dist/test/loop/loopPlusPause.test.js dist/test/loop/loopPlusGroupChatPanel.test.js`，139/139 通过。
- `npm run test:unit`：最终在主工作区执行，2910 项中 2907 通过、3 项按套件跳过、0 失败；包含展示元数据与离线消息新增回归。跳过项不作为已验证真实 CLI 路径。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（105 条规则）；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- `git diff --check` 与本次文档的 `npm run validate:whitespace -- --files ...`：通过；专题 runbook 本地 Markdown 链接另做存在性核对。
- Chromium 使用 smoke skill 的结构化场景与实际编译后群聊 HTML，宽度 1280/390 均通过；断言暂停原因、安全门槛、继续入口、非整体完成和元数据隐藏。无 browser / HTTP / request 错误，截图已人工检查。
- 浏览器是本地合成 Webview，不存在登录 API，因此不伪造登录；不启动真实 CLI、业务服务或 Extension Development Host，不将浏览器结果表述为真实任务回放。
- 本机结果保存在 `.tmp/loopplus-stop-validation/1280/result.json`、`.tmp/loopplus-stop-validation/390/result.json` 及对应 `success.png`；临时场景收尾删除，不纳入提交。

## 失败分流与修复

- 新建 scheduler 快照缺少 `maxConcurrency`：测试夹具问题，补有效宿主策略，不改内核默认。
- 重试额度与延迟预留断言：新增复核阶段使旧断言过期，保持原重试上限并按完整复核流程更新。
- worktree 全量测试缺 `package-lock.json`：测试环境问题，复用主目录已有忽略型文件后全量通过；未修改依赖清单。
- 浏览器发现暂停去重注释显示为 `[object Object]`：实现缺陷，解析暂停段落时隐藏元数据，补单测并通过两种宽度复测。
- 离线消息回归初稿混淆自动恢复和显式继续：断言过度，收敛到持久化复核状态重置、消息不丢失且不隐式恢复的职责。

## 文档与记忆收口

- 用户可见行为已同步 `FEATURE_INVENTORY.md` 与能力规格；调度设计和排障指南承载稳定规则。
- Ontology 新增有界复核与分层完成提示规则，保留可核对源码与测试引用。
- 本次经验已进入专题 runbook，不重复写 `ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md`。
- 已按计划日期归档到 `completed/2026-11/2026-11-05-loopplus-block-review.md`，主工作区为最终交付和验证事实来源。

## 当前进展

- [completed] 修复编排、持久化与完成提示
- [completed] 整合主工作区并保留并行行为
- [completed] 验证群聊桌面与窄屏展示
- [completed] 完成最终全量与文档校验
- [completed] 归档执行计划并交付
