# Grok 流式空白分块保真修复

- 日期：2026-10-24
- 状态：completed
- 负责人：协作
- owner：loop-attempt-round-2-grok-stream-whitespace-contract-repair
- claimed_at：2026-10-24
- claim_ttl：本轮执行结束
- handoff_to：独立复核

## 背景

前一轮为了让宿主用例期望 `Hello world` 通过，在 `classifyGrokSessionMessage` 上新增 `readVisibleContentText`，用 `text.trim()` 丢弃 `agent_message_chunk` 和 `agent_thought_chunk` 中的纯空白文本。主复核直接调用编译后的分类器，证明该行为依赖上游分块边界：`Hello`、一个空格、`world` 变成 `Helloworld`；`first`、两个换行、`second` 变成 `firstsecond`；`def f():`、换行、四个空格、`return 1` 变成 `def f():return 1`。正文和思考共六个场景都失败。单个完整分块仍能保留原文。

## 目标

- 同一原文按不同边界分块，与单个完整分块的分类结果一致。
- 正文和思考都保留词间空格、换行、连续空行、制表符、代码缩进、尾随空格和重复词。
- 空字符串、非文本和无效内容仍按现有协议忽略。数组文本按现有顺序无损拼接。
- 更正宿主用例里不能代表协议的 `Hello world` 期望，并补宿主分块组合验证。
- 更正前轮完成计划中的错误结论，不改写其原始测试数字。

## 范围

- `src/interactive/grokAppServerProtocol.ts`
- `src/test/interactive/grokAppServerProtocol.test.ts`
- `src/test/extensionHost/grokCliHostWire.test.ts`
- 本计划，以及前轮计划中被否决的空白结论。
- 复发说明：`.ch/docs/runbooks/PITFALLS.md`、`.ch/docs/memory/EVENT_MEMORY.md`。

## 非目标

- 不新增缓冲、自动插入空格、统一 trim、消息去重或特殊尾部清理。
- 不改变工具事件、会话过滤、停止处理和回放时序。
- 不把展示层避免纯空白气泡的策略下沉到分类器。
- 不撤回前轮图片、模型弹窗、过期断言、规则夹具和行尾空白清理。
- 不编辑 `.ch/docs/exec-plans/active/2026-10-24-workbuddy-channel-feasibility.md`。
- 不改依赖、测试框架或覆盖率门槛，不跳过或删除有效用例。
- 不提交 commit，不执行市场发布或正式 VSIX 导出。
- 不改用户配置、调度状态、active ids、loopPlus 或父任务记录。
- 不改 UI 外观、布局或交互。

## 验收标准

- [x] 新增分块保真回归先在旧实现上失败，并留下日志和退出码。
- [x] 分类器保留所有非空有效文本，包括纯空白增量。
- [x] 空字符串、非文本、无效内容仍忽略；数组按顺序拼接。
- [x] 宿主分块组合与单个完整分块的正文和思考一致。
- [x] `npm run build`、协议/宿主/runner/replay 最小测试、`npm run test:unit`、`--list`、`npm run validate:whitespace`、`git diff --check` 已串行执行并记录真实结果。
- [x] 前轮计划的 1917 通过记录保持原样，错误结论已标明被否决。

## 影响面

- 代码目录：Grok ACP 会话更新分类器，以及协议测试、宿主接线测试。
- 文档目录：本计划、前轮完成计划的结论更正、PITFALLS、EVENT_MEMORY。
- 配置与脚本：不改。

## 事实来源

- 产品规格 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 第 233 行：Grok 正文/思考保持实时，回放合并保留空白和重复词。
- `src/interactive/grokRunner.ts` 的 `handleMessage` 将 `assistant_text` 原样传给 `onAssistantDelta`，将 `thinking` 原样传给 `onTrace`。
- 回放 `readReplayText` 只跳过空字符串，纯空白参与 1 秒 / 32 KiB 合并。
- 展示层 `FEATURE_INVENTORY` 的“空思考与回复气泡过滤”只隐藏可见性，不删除流式状态。
- Ontology `status=ready`，业务域 `cli-plugin-runtime`。关键词“Grok 流式 正文 思考 空白”未形成“丢弃纯空白增量”的规则。本次不新增概念。
- CodeGraph 索引按任务说明视为可能陈旧。定位后直接读取当前 `grokAppServerProtocol.ts`、宿主接线测试和 runner。

## 风险与缓解

- 风险：`npm run build` 会清空 `dist`，并行构建互相污染。
- 缓解：构建和测试全部串行，并在真实仓库根目录执行。
- 风险：为绿灯放宽宿主断言。
- 缓解：断言改为与输入逐字相同的正文和思考，并要求分块结果等于完整分块。
- 风险：改动回放合并或思考气泡折叠。
- 缓解：不修改 `grokReplayStream.ts` 与 `grokThinkingBubbles.ts`。

## 验证计划

- 失败复现：只改测试后 `npm run build`，再运行协议与宿主编译测试。
- 修复后：`npm run build`，然后 `node --test` 协议、宿主、runner、replay。
- 全量：`npm run test:unit`。
- 清单与静态：`node scripts/run_unit_tests.js --list`、`npm run validate:whitespace`、`git diff --check`。

## 测试与清单同步

- 单元测试新增/更新：用 `preserves Grok assistant and thinking text across chunk boundaries` 替换错误的 `drops blank Grok text chunks`。宿主原用例改为 `Hello world   ` 与 `consider the file   `。新增 `Grok host chunk boundaries match one complete assistant and thinking chunk`。
- 失败复现：`/tmp/sinitek-loop-whitespace/fail-protocol-host.log`，退出码 1。`tests 38 / pass 35 / fail 3 / skipped 0 / cancelled 0`。协议实际值 `Helloworld`，期望 `Hello world`。宿主分块实际丢掉换行、缩进和制表符。
- 修复后最小测试：`/tmp/sinitek-loop-whitespace/minimal.log`，退出码 0。`tests 104 / pass 104 / fail 0 / skipped 0 / cancelled 0`。
- 全量：`/tmp/sinitek-loop-whitespace/test-unit.log`，退出码 0。`tests 1918 / pass 1918 / fail 0 / skipped 0 / cancelled 0 / todo 0`。
- 清单：`/tmp/sinitek-loop-whitespace/list.log`，退出码 0，214 个 `dist/test/**/*.test.js`，没有 `src/test/**/*.ts`。
- 空白校验与 `git diff --check`：退出码都是 0。
- 功能清单：无需更新。规格已要求保留空白；展示层过滤策略不变。
- ontology：无需更新。没有新概念、权限、状态机或事实来源路径变化。

## 任务列表

- [x] 补分块保真回归并在旧实现上记录失败。
- [x] 撤销 `trim()` 丢弃，保留非空文本。
- [x] 串行完成构建、最小测试和全量回归。
- [x] 更正前轮结论，归档本计划，写 attempt 报告。

## 决策记录

- 2026-10-24：分类器的有效增量是非空字符串。空字符串仍忽略。纯空白不是无内容。
- 2026-10-24：宿主用例输入包含三个空格时期望 `Hello world`，这是过期断言，不能定义协议。无损结果是 `Hello world   `，思考是 `consider the file   `。
- 2026-10-24：前轮 `npm run test:unit` 的 1917 通过只证明错误契约下的绿灯，不改写该数字。
- 2026-10-24：修复后的生产分类器与 HEAD 一致。缺陷只存在于前轮未提交的 `readVisibleContentText`。撤销后不再保留该函数。

## 当前结论

分类器再次按非空字符串保留正文和思考增量。分块结果与完整分块一致。全量 1918 通过，0 失败，0 跳过，退出码 0。归档路径：`.ch/docs/exec-plans/completed/2026-10/2026-10-24-grok-stream-whitespace-contract-repair.md`。未提交 commit。未执行市场发布或正式 VSIX 导出。

整段只有空白的消息仍可能在落盘 `sanitizeMessages` 时被去掉。这是既有展示/存档策略，分类器不再提前删除增量。
