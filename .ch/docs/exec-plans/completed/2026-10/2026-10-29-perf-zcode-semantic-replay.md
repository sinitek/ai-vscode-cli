# ZCode 回放语义降噪 — 性能优化

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex
- 类型：perf

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-29-zcode-semantic-replay.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-29-docs-zcode-semantic-replay.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

聚合 ZCode 语义回放并有界合并文本，降低新任务记录数量。仅承担性能优化；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的性能优化；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-29-perf-zcode-semantic-replay.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景与目标

- 上一轮补齐 ZCode 回放链路后，全部原生事件逐条入回放。用户反馈一次天气查询产生约 50 条记录。本次在保留诊断价值与完整正文的前提下，参考 Grok/Kimi 的已知噪音过滤、固定时间窗文本合并和工具生命周期聚合，降低新任务回放数量。

## 已核对的事实

- 已执行 memory-recall（focus：`ZCode replay 回放过滤 Grok Kimi 语义事件 合并`，anchor 为空）。

- 插件未生成该次 ZCode 专用调试日志，不能声称已取得原来的完整 50 条线协议事件。

- 只读核对原生 CLI 日志、最近天气会话元数据及模型 I/O 记录：该次查询有两轮模型请求、一次 WebFetch 调用，均正常结束；不复制真实提示词、工具输出或凭据进仓库。

- 新建无工具真实对话采集 9 条原生事件：标题 1 条、回合开始 1 条、会话计数快照 4 条、正文分片 2 条、回合完成 1 条。实际 envelope 包含 `seq/eventId/timestamp/turnId`，正文包含 `assistantMessageId/delta/done/kind`。

## 范围与非目标

- 范围：ZCode 回合内回放投影、结束／失败／停止排空、对应测试、说明文档。

- 非目标：不改变实时聊天、思考或工具气泡；不调整 CLI 权限、模型和配置；不改其他 CLI 或历史回放，不写入用户原生数据库与日志。

## 验收标准

- 已知标题／会话计数快照不新增回放；未知结构与错误保守保留。

- 同会话、同回合、同消息和相同语义元数据的正文／思考分片按 1 秒或 32 KiB 合并，保留空白、重复文本和顺序。

- 工具输入分片按调用身份合并，去掉重复启动进度与终态，保留必要输入、结果、失败及缺少可靠身份的原始事件。

- 实时聊天与活动时间不等待回放刷新；完成、异常和停止不丢待刷内容，不串入下一回合。

- 构建、最小相关单测、文档结构校验及最小真实 CLI 验证通过，记录真实前后数量，不把合成测试冒充原天气回放。

## 风险与缓解

- 误过滤新协议字段：限定已知无意义字段／类型，异常、未知事件和有差异的语义元数据保守保留。

- 计时合并丢尾部或停止时宿主拒收：每回合独立实例、终态／异常同步排空，停止只开放当前执行的同步排空窗口。

- 日志与用户数据：只做本机只读统计，仓库测试使用明确的合成数据。

## 验证计划与影响面

- 代码：新增 `src/interactive/zcodeReplayStream.ts`，接入 runner 和必要的宿主停止窗口。

- 文档：同步 `docs/zcode-guide.md`、功能清单与 `plugin.rule.zcode_task_replay`；不改变架构边界，无需扩写架构文档或滚动摘要。

## 实施结果

- 新增独立的 `ZcodeReplayStream`，过滤已知标题／计数快照、主模型成功首试遥测和重复成功摘要，保守保留重试、停顿、异常、未流式输出的摘要正文及未知字段。

- 正文／思考在消息身份和语义元数据一致时，按固定 1 秒或 32 KiB 合并；工具输入聚合为原生结构的调用事件，去掉重复调度／启动／结果、已有结果的成功批次及恢复提交确认。

- runner 仍即时投影聊天、思考、工具和活动时间；完成、失败、拒绝发送、进程异常和停止排空，当前执行的停止排空窗口按 `runId` 隔离。

- 包含明确标记的隔离合成 50 条记录降至 6 条的用例；这不是用户原天气查询的完整重放。

- 已同步 `docs/zcode-guide.md`、无需修改 `ARCHITECTURE.md`；不重复写入热区或事件记忆，也不写滚动摘要。

## 验证记录

- `npm run build`：通过。

- `node --test --test-reporter=tap dist/test/interactive/zcodeReplayStream.test.js dist/test/interactive/zcodeRunner.test.js dist/test/extensionHost/interactiveTurnZcode.test.js`：52/52 通过。

- `node --test --test-reporter=tap dist/test/interactive/zcode*.test.js dist/test/config/zcodeConfig.test.js dist/test/extensionHost/interactiveTurnZcode.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/interactive/grokReplayStream.test.js dist/test/interactive/kimiReplayStream.test.js`：105/105 通过，包含上述 52 条用例。

- `node --test --test-name-pattern='run stream|raw stream|replay|回放' --test-reporter=tap dist/test/webview/clipagescriptruntimecoverage.test.js`：7/7 通过。

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 domains / 17 concepts / 16 relations / 78 rules / 2 workflows / 3 documents。

- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。

- `git diff --check`：通过。

- 真实纯文本／Shell 隔离会话采集的原生事件，使用编译后的 `ZcodeReplayStream` 离线投影：分别为 9→3、25→6；严格比对正文、思考、工具名称与输入、工具结果和末尾终态，均保留。离线投影没有真实时间间隔，不等同于实时数量。

- 使用 `node` heredoc 加载 `dist/interactive/zcodeRunner`，以隔离临时工作目录和 `spawnImpl` 同时统计真实 stdout 原生事件与 `onEvent`，仅运行一次 `printf ZCODE_REPLAY_SEMANTIC_OK`：27→7；正文、思考和完整工具结果相等，最后一条是 `turn.completed`。1 秒固定窗口使思考保留两条，属于预期。临时目录已清理。

- 实施中发现的失败分类：模型摘要跟踪初稿未正确收窄空状态，构建报 `TS18048`，属于本次实现缺陷；已修复并重新构建／执行相关测试。补充终态前排空未完成工具输入的顺序回归，避免先记录失败再记录工具输入。

## 边界与交付

- 原天气任务的完整 50 条线协议记录未采集，不能量化该次历史回放实际能减少到多少；仅确认日志中的两次模型请求和一次 WebFetch 正常完成。

- 未修改 Webview 实现，现有自动化回放用例已覆盖显示通道；本次不做 Chromium／Extension Development Host 手工界面验证。Windows／Linux 未做实机验收，新增逻辑使用跨平台 Node API，无平台路径约定。

- 修改作用于重新加载扩展后的新任务，不重写既有历史存档；不更改模型、权限、用户配置或原生 CLI 数据库／日志。
