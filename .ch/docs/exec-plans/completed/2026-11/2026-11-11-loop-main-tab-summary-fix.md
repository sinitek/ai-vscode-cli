# 恢复 Loop/Loop+ 主任务 Tab AI 摘要

- 日期：2026-11-11
- 状态：completed
- 负责人：Codex

## 背景与目标

用户澄清：只有子任务提示复用群聊成员标题，主任务仍需归纳 AI 摘要。上一轮错误地跳过主任务摘要生成，并在展示时覆盖为“主任务”。

## 范围与非目标

- 恢复主任务的摘要捕获、内部轮次去重与根需求回退；主任务状态投影保留已有摘要。
- 子任务继续显示完整群聊标题，Vibe、浮层样式、时长、调度和会话格式不变。

## 验收标准

- Loop/Loop+ 主任务的新用户提交可归纳摘要；内部调度使用同次提交快照，不把调度协议当需求。
- 缺少提交快照时使用任务根需求，主任务摘要不再被固定角色名称覆盖。
- 子任务仍跳过 AI 摘要生成，保持“子任务 N：完整标题”。
- 已有/缺失摘要、主任务用户新提交、内部调度、子任务拒绝与 Vibe 行为均有回归覆盖。

## 影响面与风险

- 代码：`src/extension.ts`、`src/extensionHost/sessionTabs.ts`。
- 测试：摘要捕获、成员标题投影与宿主投影；文档：功能清单、能力规格、运行时设计和 ontology。
- 风险：内部 Loop prompt 误作摘要来源；缓解：复用既有提交快照，缺失快照回退 rootPrompt。
- 回滚：仅撤销本次主任务修复，不动上一轮子任务标题实现。

## 验证计划与记录

- 先 `npm run build`，再执行最小相关会话与浮层测试；按风险扩大到会话测试集。
- 复用本机 Chromium Webview 夹具验证主任务摘要与子任务标题在宽窄屏、深浅主题下展示。
- ontology 校验和 `git diff --check`；不调用真实 provider，不发布扩展。
- 功能清单、能力规格、运行时设计和 ontology 已同步；上一轮执行记录已标注主任务相关结论被本计划纠正。
- 记忆判断：本次纠错进入本计划及规格，不新增事件记忆或滚动摘要。

## 当前进展

- 已修复生成门禁与状态投影两个根因：只跳过子任务的 AI 摘要，主任务保留已有摘要并恢复用户提交快照及根需求回退。
- 更新摘要捕获回归：Vibe 连续提交、主任务新提交、内部调度复用快照、缺少快照时 rootPrompt 恢复及子任务拒绝生成。
- 更新投影回归：经典 Loop 与 Loop+ 主任务的已有/缺失摘要保持原样，子任务完整标题不变，宿主集成断言验证主任务不再被角色名覆盖。

## 最终验证结果

- `npm run build` 通过；日志 `/tmp/sinitek-loop-main-summary-build.log`。
- 最小相关测试：`node --test dist/test/session/conversationTaskSummary.test.js dist/test/session/loopTabMemberTooltip.test.js dist/test/webview/conversationtabsummarytooltip.test.js`，43/43 通过，日志 `/tmp/sinitek-loop-main-summary-focused.log`。
- 扩大回归：`node --test dist/test/session/*.test.js dist/test/webview/conversationtabsummarytooltip.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopGroupChatCoordinator.test.js`，366/366 通过，日志 `/tmp/sinitek-loop-main-summary-regression.log`。
- 浏览器：`node .tmp/loop-tab-member-tooltip/smoke.cjs`，完整生成 Webview 的 960/280 宽度 × 深/浅主题四组合通过，无 page/console/network 错误；核对主任务摘要“恢复源码构建与前端接入路线”、Vibe 摘要与子任务完整标题，以及键盘聚焦/Escape/边界；结果 `.tmp/loop-tab-member-tooltip/result.json`，已查看 `main-280-light.png` 与 `main-960-dark.png`。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、`git diff --check` 通过。
- 本轮没有测试失败；上一轮已记录的群聊历史失败不在本轮最小修复范围内，未改动。
- 未运行真实 CLI/provider 或完整 Extension Development Host 端到端；无发布、无依赖/框架/会话格式变更。架构与运行手册无需同步。
- 结论：验收标准满足，完成并归档。
