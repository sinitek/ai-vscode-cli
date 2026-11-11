# Loop/Loop+ Tab 悬停复用群聊成员标题

> 后续纠正：用户明确只有子任务复用群聊成员标题，主任务仍需 AI 摘要；本计划中的主任务角色名投影和主任务摘要禁用结论已被 `.ch/docs/exec-plans/completed/2026-11/2026-11-11-loop-main-tab-summary-fix.md` 替代。

- 日期：2026-11-11
- 状态：completed
- 负责人：Codex

## 背景与目标

Vibe 继续使用现有异步 AI 摘要；Loop/Loop+ Tab 悬停改为群聊成员标题，子任务例如“子任务 517：恢复SpreadJS本体源码构建与前端接入路线”。

## 范围与非目标

- 仅调整宿主的 Tab 提示投影与 Loop 摘要触发，复用群聊现有标题格式和子任务身份解析。
- 不改变浮层样式、现有停留时长、Tab 布局、任务调度、会话存储；保留工作区已有改动。

## 验收标准

- Vibe 摘要生成、恢复和悬停行为不变。
- Loop/Loop+ 主任务提示为“主任务”，子任务提示的编号和完整标题与群聊一致，不受 AI 摘要 30 码点限制。
- 子任务按当前 Tab 的任务、子任务身份定位；缺少对应记录时不显示错误的旧摘要，不串 Tab。
- Loop 已知任务不再额外调用 AI 生成摘要。

## 影响面与风险

- 代码：`src/extensionHost/sessionTabs.ts`、`src/extension.ts`、`src/loopConversationPresentation.ts` 与兼容重导出的 `src/panelStateBuilder.ts`；测试：会话摘要、宿主投影、浮层回归。
- 文档：功能清单、运行时设计、能力规格与 ontology。
- 风险：继续执行、历史会话及缺失元信息导致身份不完整；使用现有消息身份解析并核对任务 ID，必要时用持久化的 CLI/session 绑定定位，不能回退到别的成员。
- 回滚：仅撤销本次局部投影与 Loop 摘要触发门禁，不触及其他未提交改动。

## 验证计划

- `npm run build`，再运行最小相关 Node 单测；按需使用本机 headless Chromium 验证实际 tooltip。
- ontology 完整性与 `git diff --check`。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/session/loopTabMemberTooltip.test.ts` 的 5 项用例，覆盖 Loop/Loop+ 标题、长标题、缺失/错配身份、历史执行绑定、共用 session 不猜测、Vibe 不变及宿主投影；更新摘要捕获和宿主提取契约断言。
- 单元自测结果：最终 `npm run build` 通过；`node --test dist/test/session/*.test.js dist/test/webview/conversationtabsummarytooltip.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopGroupChatCoordinator.test.js` 为 366/366 通过，日志 `/tmp/sinitek-loop-tab-member-regression-pass.log`。
- 浏览器验证：`node .tmp/loop-tab-member-tooltip/smoke.cjs` 使用真实 headless Chromium 加载完整生成 Webview，960/280 宽度 × 深/浅主题四组合均通过；核对 Vibe、主任务、完整子任务标题、键盘焦点、Escape 与水平边界，无 page/console/network 错误。结果 `.tmp/loop-tab-member-tooltip/result.json`，已查看 `280-light.png` 和 `960-dark.png`。
- 失败处理记录：首次构建的缺少 `createdAt` / `sessionId` 属新增测试夹具不完整，已修正；扩大测试发现的 `vscode` 依赖加载缺陷已通过轻量模块拆分修复。额外 `loopPlusGroupChatPanel` 测试 15 项中 11 通过、4 失败，属于原有计数/文案断言与当前群聊 UI 不匹配；用 `node --require ./.tmp/loop-tab-member-tooltip/baseline.cjs --test dist/test/loop/loopPlusGroupChatPanel.test.js` 注入本次修改前的 HEAD `panelStateBuilder.ts` 仍复现完全相同 4 项失败，证据 `/tmp/sinitek-loop-tab-member-baseline.log`，未修改无关群聊测试与 UI。
- 静态验证：ontology 校验通过（2 domains / 17 concepts / 16 relations / 127 rules / 2 workflows）；`git diff --check` 通过；宿主改动的 UI 机械检测结果为空数组。
- 功能清单与设计/ontology：已同步 `FEATURE_INVENTORY.md`、能力分册、运行时设计及 `cli-plugin-runtime.json`；架构和运维边界不变，无需修改总架构或运行手册。
- 未验证：未做真实 CLI/provider 调用或完整 VS Code Extension Development Host 端到端；本次不改变 CLI 协议与执行行为，不运行发布脚本。
- 记忆判断：单次局部行为变更由规格与本计划承接，不新增热区或事件记忆。

## 当前进展

- 已核对 CodeGraph、现有源码和 ontology；确认群聊共用 `getLoopSubtaskDisplayTitle` 与 `getLoopMainSubChatMainTitle`。
- 召回焦点：Loop 子任务 tab 悬停摘要 群聊成员标题；anchor 为空，召回索引较旧，当前代码与规格为事实来源。
- 已实现投影与触发门禁，新增成功/边界/拒绝/历史恢复/跨 CLI/共用 session 不猜测及宿主集成回归。
- 扩大验证时发现直接依赖 `panelStateBuilder` 会将 `vscode` 带入原本可独立加载的 Tab 宿主；已将共用格式与身份解析原样下沉到轻量模块，旧导出兼容保留。属于本次实现缺陷，修复后相关会话测试恢复通过。
- 浏览器首次运行因夹具把 `state` 事件内容放在 `state` 而非现有契约的 `payload` 中未加载 Tab，已修正夹具；没有修改运行时事件契约。
- 最终结论：验收标准满足，相关验证完成并归档；保留工作区原有改动，不提交、不发布。
