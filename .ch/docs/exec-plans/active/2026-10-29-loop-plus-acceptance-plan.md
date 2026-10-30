# Loop+ 启动前验收方案

- 日期：2026-10-29
- 状态：in-progress
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-29
- claim_ttl：本次任务
- handoff_to：

## 背景

Loop+ 主模型当前只有一组写死在提示词里的验收清单，用户无法在启动前追加自己关心的审查方向（例如“上线前额外做一次安全审查”）。需求是把这份附加要求做成可保存、可复用的“验收方案”，在新建 Loop+ 根任务发送前确认，并随任务一起快照，保证后续模板修改不影响已启动的任务。

## 目标

- 新建 Loop+ 根任务发送前弹出“验收方案”弹窗，确认后才启动任务；续跑、恢复、补充需求、排队补发不重复弹出。
- 固定基线始终勾选且禁用，另外五项默认不勾选；“其它”勾选才显示“审查内容”并做非空校验。
- 方案可保存、可复用、可原地改名；系统默认内置只读。
- 方案与选中项写入工作区设置；确认结果随任务记录快照持久化并注入五类主模型提示。

## 范围

- 新增 `src/loopPlusAcceptancePlan.ts`（类型、归一化、方案 CRUD、提示词片段）。
- 新增 `src/extensionHost/loopPlusAcceptancePlanHost.ts`、`src/panelMessageHandlers/loopPlusAcceptancePlan.ts`。
- 扩展 `src/workspaceSettingsStore.ts`（方案字段 + 带结果的保存接口）。
- 运行时链路：`src/sessionMessageActions.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/loopTaskStore.ts`、`src/extension.ts`。
- Webview：`src/webview/viewContentHtml.ts`、`src/webview/viewContentStyles/overlaysModals.ts`、`src/webview/viewContentScript/acceptancePlan.ts`、`src/webview/viewContentScript/runStreamAndQueue.ts`、`src/webview/viewContentScript/taskListAndUi.ts`、`src/webview/types.ts`、`src/webview/viewContentStrings.ts`、`src/panelStateBuilder.ts`。
- 文档：本计划、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/runbooks/PITFALLS.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`。

## 非目标

- 不做方案删除、导入、导出、排序或跨工作区共享。
- 不改经典 Loop / Graph / Vibe 的发送与验收行为。
- 不新增自动强制扫描、基准测试或主模型测试执行要求。
- 不改 Loop+ 调度、并发、验收次数与固定六项清单本身。

## 验收标准

- [x] 新建 Loop+ 根任务发送前出现“验收方案”，确认后才发送；续跑/恢复/补充需求不出现。
- [x] 取消不建任务、不发请求、不清空输入/附件/上下文。
- [x] 基线勾选且禁用，五项默认不勾选，“其它”显隐与空值校验符合要求。
- [x] 保存方案、命名弹窗、重名拒绝、原地改名不产生重复项。
- [x] 方案与选中项落工作区设置，损坏数据回退系统默认且不影响其它字段。
- [x] 确认结果随任务快照持久化，五类主模型提示注入且固定清单不削弱。
- [x] 构建、相关单测、Chromium 冒烟与 Ontology 校验通过。
- [x] 自定义方案不能占用「系统默认」这个名字；命名弹窗保存未返回前不重复提交，禁用按钮时焦点留在名称输入框。
- [ ] 只提交本任务文件（本子任务不提交）。

## 群聊修改

- 2026-10-30：Loop+ 群聊顶部增加「验收方案」，复用同一弹窗。确认后写回任务快照；进行中的复核或收尾中止并按新快照重问。只改模板仍不改已启动任务。
- 2026-10-30：弹窗标题改为「主模型验收方案」。下拉第一项是「新增方案」，方案名称始终显示；系统默认预填「默认方案」，保存直接用该名称新建，不再弹出命名框。
- 2026-10-30：窄屏下方案下拉与「保存方案」保持同一行；宽屏下拉仍为 250px，更窄时下拉收缩。
- 2026-10-30：下拉里内置项的显示文字从「系统默认」改为「默认方案」。内部 id 与任务快照名称仍是系统默认。
- 2026-10-30：去掉方案名称标签，输入框用占位文字「方案名称」。
- 2026-10-30：去掉“其它”文本域上方的「审查内容」标签，占位文字改为「审查内容」。
- 2026-10-30：同名保存自动覆盖。已保存的「默认方案」顶替下拉里的内置项，删除后内置项重新出现。「保存方案」改为「保存」，右侧增加「删除」，删除前确认；内置方案不能删除。
- 2026-10-30：Loop+ 主任务状态为 completed 后，群聊顶部不再显示「验收方案」。

## 本轮复核

- 日期：2026-10-29
- 主链路（弹窗、工作区设置、任务快照、五类主模型提示）已在未提交改动里落地。本轮补上两处缺口：`hasLoopPlusAcceptancePlanName` 把「系统默认」视为已占用；命名弹窗在保存返回前忽略第二次提交，并在禁用「保存」按钮时把焦点留在名称输入框，避免 Esc 关不掉上层弹窗。
- 验证：`npm run build` 通过。`node --test` 覆盖 `loopPlusAcceptancePlan`、`workspaceSettingsStore`、`loopPlusAcceptancePlanHost`、`loopPlusPromptBuilders`、`loopPlusOrchestration`、`loopTaskStore`、`sessionMessageActions`、`loopPlusAcceptancePlanDialog`、`loopPromptQueue`，179 项通过；补测后对话框与核心用例再次通过。`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过。重建页面后 Chromium 冒烟 `open`、`default-unchecked`、`other`、`confirm`、`cancel`、`create-rename`、`narrow-390`、`narrow-420`、`reopen`、`edge-cases`、`saving` 通过。
- 下一步：按计划本子任务不提交。

## 影响面

- 代码目录：`src/loopPlusAcceptancePlan.ts`、`src/extensionHost/`、`src/panelMessageHandlers/`、`src/webview/`
- 测试目录：`src/test/core/`、`src/test/extensionHost/`、`src/test/webview/`、`src/test/loop/`、`src/test/session/`
- 文档目录：本计划、产品规格、设计文档、PITFALLS、Ontology
- 配置与脚本：无新增配置项；复用工作区设置存储

## 风险与缓解

- Webview 发送链路逐字段拼装 `sendPrompt`，新增字段容易被静默丢弃：在 `normalizePromptPayload`、`dispatchPrompt` 两处同步，并用浏览器冒烟断言最终 `postMessage`。
- 异步弹窗可能跨标签错配：打开时捕获来源 tab/payload，确认前重新校验 tab 仍存在且模式仍是 `loop_plus`，否则提示会话已变化并保留草稿。
- 重复提交：确认前先置 `submitting`，确认路径绕过门禁直发，弹窗状态在发送后清空。
- 旧数据兼容：归一化对缺失/布尔旧格式/损坏项全部降级为系统默认，空基线快照不写任务记录。

## 验证计划

- 构建：`npm run build`
- 单测：`node --test dist/test/core/loopPlusAcceptancePlan.test.js dist/test/core/workspaceSettingsStore.test.js dist/test/extensionHost/loopPlusAcceptancePlanHost.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/loop/loopTaskStore.test.js dist/test/session/sessionMessageActions.test.js dist/test/webview/loopPlusAcceptancePlanDialog.test.js`
- 浏览器：`node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/loop-plus-acceptance-smoke/scenario-*.json`，证据在 `.tmp/playwright-smoke/loop-plus-acceptance-plan-*`
- Ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`

## 测试与清单同步

- 新增 `src/test/core/loopPlusAcceptancePlan.test.ts`、`src/test/extensionHost/loopPlusAcceptancePlanHost.test.ts`、`src/test/webview/loopPlusAcceptancePlanDialog.test.ts`。
- 更新 `workspaceSettingsStore`、`loopPlusPromptBuilders`、`loopPlusOrchestration`、`loopTaskStore`、`sessionMessageActions`、`loopPromptQueue` 测试。
- 功能清单与能力规格新增“启动前验收方案”，Ontology 新增 `plugin.rule.loop_plus_acceptance_plan`。
