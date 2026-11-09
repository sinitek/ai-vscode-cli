# Loop 批次进度与群聊进度展示

- 日期：2026-11-09
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-09
- claim_ttl：本次任务
- handoff_to：无

## 背景与目标

经典 Loop 没有总体进度；Loop+ 已按验收批次更新。为经典 Loop 增加由主模型根据批次汇报判断的进度，同时统一两种模式的群聊标题栏展示。

## 范围与非目标

覆盖经典 Loop 决策协议、进度持久化、群聊投影、标题栏样式和回归测试。不改变 Loop 不做主模型验收的规则，不改变 Loop+ 的验收与完成门禁，不调整已有未提交的气泡保留等改动。

## 验收标准

- 经典 Loop 初始为 0%，仅在批次结束后的有效主任务决策更新 0–99% 总体进度，不按子任务数量推算；最终完成为 100%，暂停、中止和续跑保留进度。
- 两种模式的群聊副标题只有任务 ID，成员主任务标题均带进度。
- 中止按钮左侧展示较大字号百分比，按 [0,20)、[20,40)、[40,60)、[60,80)、[80,100] 分五档主题色背景；窄屏不拆散进度与中止按钮。
- 覆盖协议校验、批次边界、持久化、两种模式投影、初次渲染及内容补丁；构建和相关测试通过，完成 Chromium 深浅主题与窄屏检查。

## 影响面与风险

- 代码：`src/loopTaskStore.ts`、经典 Loop 决策解析/状态机/提示词、`src/panelStateBuilder.ts`、群聊 Webview 与相关测试。
- 文档：功能清单、Loop 调度设计、ontology。
- 风险：提前显示 100%、初次拆分误报进度、Loop+ 完成门禁漂移、主题对比不足、覆盖工作区已有改动。
- 缓解：共享数值校验、经典批次结束边界、保留 Loop+ 投影完成判断、主题语义色和浏览器检查、只做定点补丁。

## 验证计划

- `npm run build`，然后串行执行最小相关 Node 单测，并按风险扩展 Loop / Webview 回归。
- 使用真实群聊 HTML 和内容补丁进行 headless Chromium 截图、五档边界、深浅主题与窄屏布局检查，不调用真实模型或改动用户运行数据。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 和文档空白校验。

## 测试与清单同步

- 单元测试新增/更新：经典进度协议及非法值、首次拆分与批次结束边界、补充需求重新校准、停止/续跑保留、完成 100%、存储往返与两种模式隔离、群聊投影、标题栏五档边界和内容补丁、主任务不验收提示词；更新旧副标题断言。
- 单元自测结果：`npm run build` 通过；`node --test` 执行 `loopMainDecisionParsing`、`loopTaskStateMachine`、`loopTaskStoreCoreCoverage`、`loopPlusPanelState`、`loopGroupChatPanel`、`subtaskCliExecution` 六个测试文件，149/149 通过。扩大至 `dist/test/loop/*.test.js`、`dist/test/extensionHost/loop*.test.js`、`subtaskCliExecution`、`extensionHostExtractionContracts` 和 `looppluswebviewintegration`，683 项中 679 通过，4 项既有失败。
- 失败处理记录：实现阶段修正可空 Loop+ 投影类型；新夹具使用既有 `LoopRunStatus=end` 并满足子任务提示词最小长度。扩大回归的 4 项失败均在 `loopPlusGroupChatPanel.test.ts`：既有改动删除侧栏 `current` / `reviewed` 计数和活动说明，旧断言仍要求这些内容。用仅在内存撤去本次副标题/进度控件的 require hook 复跑同四项，得到相同失败，未改动范围外实现或断言。证据：`.tmp/loop-progress/baseline-tests.log`、`.tmp/loop-progress-broad-tests.log`。
- Chromium：使用真实群聊 HTML、真实状态构建器/内容补丁和模拟 VS Code 消息桥，Loop / Loop+ × 深色/浅色 × 1440px/320px 共 8 组 smoke 全通过；另有 88 项实时补丁、五档端点、完成移除中止按钮、字号、背景区分、同排不重叠检查全通过，最低文本对比度 6.92:1，无浏览器/网络错误。未启动真实模型、未更改用户运行数据。
- 结构校验：ontology 校验通过（118 条规则）；本次文件空白校验及 `git diff --check` 通过。设计扫描仅报告既有 Markdown 引用块左边框，不属于新增进度样式。
- 功能清单与相关文档：已同步 `FEATURE_INVENTORY.md`、`loop-plus-scheduling.md` 和 ontology；本次无架构边界变化，不更新 `ARCHITECTURE.md`；无额外跨会话热区或事件记忆需更新，未写 `ROLLING_SUMMARY.md`。

## 任务列表

- 核对进度逻辑与页面规范：已完成。
- 实现批次进度与五档展示：已完成。
- 补充测试并验证页面：已完成。

## 决策记录

- 2026-11-09：经典 Loop 复用主任务批次间决策返回 `progressPercent`，不增加验收；与 Loop+ 分字段存储，避免模式混读。五档配色使用 VS Code 主题色和混色背景，保留明确百分比而非仅颜色传意。

## 当前结论

本次需求已完成并验证，保留工作区所有既有改动。经典 Loop 通过批次间主模型决策保存独立进度，Loop+ 原有验收进度门禁不变，两种模式使用一致的任务 ID 副标题和五档背景进度控件。截图与报告保留在 `.tmp/loop-progress/`；上述 4 项已复现的既有侧栏断言漂移不在本次修复范围。
