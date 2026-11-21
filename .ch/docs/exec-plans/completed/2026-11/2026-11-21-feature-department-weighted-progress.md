# 产研部群聊实时加权进度

- 日期：2026-11-21
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-21
- claim_ttl：本轮任务结束
- handoff_to：无

## 背景

产研部群聊的整体进度目前依赖总监决策中的 `loopProgressPercent`，组长任务进度变化虽会刷新已打开群聊，但不会即时贡献到整体进度。用户要求按各组长任务占整体的权重累计，例如权重 20%、组长进度 50% 时整体贡献 10%。

## 目标

组长模块分配整体进度权重；总监群聊每次投影都按可信组长进度实时重算加权总进度。根任务通过既有完成门禁后固定显示 100%。

## 范围

- 在主任务决策和子任务持久记录中承载模块进度权重，并校验为 1–100 的整数。
- 对已登记模块及本次新增模块校验总权重不超过 100；未声明权重的旧记录保持可读兼容。
- 总监增派时可通过 `directorProgressWeights` 调整已登记模块的权重，与新增模块一并保存。
- 总监派工提示说明权重代表占原始整体目标的份额，不按组长数量归一化。
- 群聊投影使用可信组长记录进度计算 `Σ(权重 × 组长进度) / 100`，并让总监群聊总体进度和主任务标题呈现该结果。
- 保留组长状态变化后现有开放群聊刷新链路；整体任务完成仍由原门禁确认并显示 100%。
- 补充持久化、输入校验、加权计算和实时刷新测试，并同步产品清单、群聊 UI 契约及 Ontology。

## 非目标

- 不改组长自身进度算法、总监完成门禁、工作分派策略或员工执行流程。
- 不为历史模块猜测权重；不存在可信权重时保留原总监进度显示。
- 不改变普通 Loop/Loop+ 群聊进度。

## 验收标准

- [x] 整体权重 20%、组长进度 50% 时，总监群聊总体进度显示 10%。
- [x] 多模块贡献按各模块占整体的份额求和。
- [x] 无权重的历史任务沿用总监进度。非法权重或总权重超过 100 时拒绝该分配。
- [x] 组长进度更新后，已打开总监群聊通过现有刷新链路更新整体百分比。
- [x] 根任务完成门禁通过后整体进度显示 100%。
- [x] `npm run build` 与相关单测通过。

## 影响面

- 代码目录：`src/loopTaskStore.ts`、`src/extensionHost/promptRunRuntime.ts`、`src/extensionHost/loopTaskStateMachine.ts`、`src/extensionHost/loopOrchestration.ts`、`src/extensionHost/departmentGroupChatProjection.ts`、群聊状态构建及测试。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/design-docs/department-group-chat-ui-contract.md`、`.ch/docs/ontology/`。
- 脚本：`scripts/department_group_chat_host_smoke.cjs`。

## 风险与缓解

- 风险：旧任务没有模块权重，直接套用新算法会令历史进度突降。
- 缓解：无可信模块权重时回退原 `loopProgressPercent`；新权重只在校验通过后用于加权投影。
- 风险：分批派工造成累计权重超过 100。
- 缓解：结合既有模块和本次派工在应用决策前校验总权重，拒绝不一致的决策。

## 验证计划

- 最小相关验证：进度权重解析/持久化、部门投影、群聊状态刷新测试。
- 单元自测命令：`npm run build`，`node --test dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/extensionHost/loopTaskStateMachine.test.js dist/test/loop/loopTaskStoreCoreCoverage.test.js dist/test/loop/departmentGroupChatHost.test.js dist/test/extensionHost/departmentproductioncomposition.test.js dist/test/extensionHost/departmentruntimecomposition.test.js dist/test/loop/departmentGroupChatPanel.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopGroupChatPanel.test.js`。
- 浏览器验证：`DEPARTMENT_UI_DIST=dist DEPARTMENT_UI_EVIDENCE=/tmp/department-weighted-progress-browser-20261121 node scripts/department_group_chat_host_smoke.cjs`。
- 本体验证：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。

## 测试与清单同步

- 单元测试覆盖：权重解析、数据持久化、增派时调整权重、总权重越界、可信进度求和及开放群聊刷新。
- 单元自测结果：标准构建及 305 项测试通过。
- 浏览器验证结果：使用任务记录夹具验证工具栏初始 10%、组长进度更新后 13%、整体完成后 100%。浏览器错误为空。真实 CLI 和 Extension Development Host 未执行。
- 失败处理记录：修正 Webview 消息断言，使其读取工具栏 `actionsHtml`。状态机测试使用真实持久化形状的夹具，避免 JSON 克隆丢弃 `undefined` 字段造成的断言失败。重跑均通过。
- 功能清单、群聊 UI 契约和 `plugin.rule.department_director_decision_progress` 已同步，本体校验通过。

## 任务列表

- [x] 核实当前进度来源、群聊投影和刷新链路。
- [x] 核对产品契约和 Ontology 进度规则。
- [x] 保存并校验组长模块整体权重。
- [x] 实现群聊实时加权进度投影并补回归测试。
- [x] 同步产品清单、群聊契约和 Ontology。
- [x] 运行构建、定向单测和浏览器 smoke。

## 决策记录

- 2026-11-21：权重是模块占整体目标的绝对份额。历史模块缺权重时沿用以前的总监进度。整体完成仍以组织完成门禁通过为准。

## 当前结论

总监群聊使用可信组长记录实时计算加权总体进度。稳定业务规则已记录在群聊 UI 契约、功能清单及本体中。
