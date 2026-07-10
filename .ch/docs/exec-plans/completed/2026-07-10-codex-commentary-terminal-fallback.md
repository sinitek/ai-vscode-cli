# Codex commentary 成功回合终态兼容

- 日期：2026-07-10
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-10
- claim_ttl：本次会话
- handoff_to：

## 背景

`~/.sinitek_cli` 的真实日志显示，Codex 会话 `019f4b72-86f8-72b3-80f0-860bf9b467c4` 在收到 `hi` 后输出了非空 `agent_message phase:"commentary"`，随后以 `turn.completed status:"completed"` 正常结束，但没有发送 `phase:"final_answer"`。现有终态判定只接受显式 `final_answer`，因此在 `2026-07-10 17:53:54` 和 `17:54:06` 两次错误触发“缺少最终结论”自动继续。

这说明 Codex app-server 的实际终态不能只依赖消息 phase：`final_answer` 仍是首选的显式信号，但成功 `turn.completed` 也可能终结一个只有 commentary assistant 文本的回合。

## 目标

- 保留显式 `phase:"final_answer"` / `codexFinalAnswer=true` 的优先判定。
- 在工具设置全局参数中提供 `completed_turn_fallback` 与 `strict_final_answer` 两种 Codex 最终答复判定策略，默认选择前者。
- 兼容策略下，Codex 回合成功完成、已产生非空普通 assistant 文本且未出现显式 final answer 时，把最后一条 assistant 气泡原位提升为最终结论。
- 严格策略下继续要求显式 `final_answer`，缺失时沿用现有自动继续行为。
- 空回复、失败回合和主动停止仍不得通过该兜底收口。

## 范围

- Codex app-server assistant 事件与 `turn/completed` 的运行时适配。
- 全局工具设置归一化、`~/.sinitek_cli/settings.json` 持久化、PanelState、Webview 控件和中英文文案。
- Codex 终态兼容逻辑的纯单元回归测试。
- CLI 运行事实、功能规格和避坑文档同步。

## 非目标

- 不修改 Claude / OpenCode 的最终结论判定。
- 不改变 hidden retry 次数、延迟或可见提示。
- 不根据 assistant 文案猜测是否为结论。
- 不改动 Webview 样式或消息数据结构。

## 验收标准

- [x] 显式 Codex final answer 继续直接标记最终气泡，回合结束时不重复提升。
- [x] 只有 commentary 非空文本的成功回合会原位补 `codexFinalAnswer=true`，不触发缺失结论自动继续。
- [x] 工具设置全局页可切换“成功回合兼容（默认）”与“严格 final_answer”，缺失/非法持久值默认使用兼容策略。
- [x] 严格策略下 commentary + completed 不提升，继续触发现有缺失最终结论自动继续。
- [x] 没有 assistant 文本的成功回合仍由现有缺失结论逻辑处理。
- [x] `failed`、非完成状态或主动中断不会提升 commentary。
- [x] 最小相关单元测试和 `npm run build` 通过。
- [x] 产品规格、CLI 运行事实与复发问题记录保持一致。

## 影响面

- 代码目录：`src/interactive/`、`src/toolSettings.ts`、`src/sessionMessageActions.ts`、`src/panelStateBuilder.ts`、`src/webview/`、`src/extension.ts`
- 测试目录：`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/runbooks/`
- 配置与脚本：无

## 风险与缓解

- 风险：过程性 commentary 在 Codex 已成功结束回合时被展示为最终气泡。
- 缓解：默认兼容策略只以结构化 `turn.completed status:"completed"` 触发，不根据文案判断；仍需要旧严格语义的用户可选择 `strict_final_answer`。
- 风险：空回合因终态兜底被误判成功。
- 缓解：必须先观察到非空 assistant 文本；空增量和 thinking/trace 不计入。
- 风险：显式 final answer 被重复拆出空气泡。
- 缓解：观察器记录显式终态，兜底只发送空内容的原位标记且最多执行一次。

## 验证计划

- 最小相关验证：`npm run build && node --test dist/test/codexRunnerRuntime.test.js dist/test/finalConclusion.test.js`
- 单元自测命令：同上。
- 扩展验证：运行 `node --test dist/test/*.test.js`。
- 静态核验：确认 `media/official_skills_catalog.json` 全部 description 已为中文，无需改动 catalog。

## 测试与清单同步

- 单元测试新增/更新：为设置默认值/归一化/消息回写、Webview 控件、successful commentary fallback、严格模式、显式 final、空回复、失败/非完成状态增加断言。
- 单元自测结果：`npm run build` 通过；定向测试 46/46 通过；排除两个已知失败文件后的扩展回归 329/329 通过。
- 失败处理记录：全量 `node --test dist/test/*.test.js` 为 381 项、358 通过、23 失败。失败全部集中在未改动的 `configService.test.js`（1 项，配置中心静态资源缺少既有断言文案）和 `lobsterBoundaryRecord.test.js`（22 项，待实现/导出的 boundary API 与源码契约），归类为范围外历史失败；排除这两个文件后其余 329 项全部通过。
- 功能清单：已在 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 增加“最终答复判定策略”条目。
- 相关文档同步：已更新能力规格、CLI runtime reference 和 `PITFALLS.md`。

## 任务列表

- [x] 从真实日志锁定误判会话和事件顺序。
- [x] 确认现有 final answer 与 hidden retry 调用链。
- [x] 实现全局策略设置与成功回合 commentary 终态提升。
- [x] 增加回归测试并同步事实来源。
- [x] 执行最小测试、全量测试和 Node build。
- [x] 记录验证结果并归档计划。

## 决策记录

- 2026-07-10：修正 2026-06-14 的“必须显式 final_answer”绝对规则。显式 phase 仍优先；当实际 Codex app-server 已以 `status:"completed"` 成功结束且本回合有非空 assistant 文本时，结构化回合终态作为兼容 fallback。
- 2026-07-10：在 runner 事件适配层补标记，不在 `finalConclusion.ts` 放宽所有历史 commentary 消息，避免旧消息或非成功回合绕过终态条件。
- 2026-07-10：按用户追加要求提供两种全局策略；默认 `completed_turn_fallback`，`strict_final_answer` 保留 2026-06-14 的旧行为。策略按每次回合读取，不绑定或重建持久会话 runner。

## 当前结论

已完成。工具设置全局页新增 Codex 最终答复判定下拉，默认 `completed_turn_fallback`，可切换 `strict_final_answer`。默认策略会在成功 completed 且已有非空 assistant 答复时原位补终态标记；严格策略保留旧的显式 final-only 和自动继续行为。实现、国际化、文档和定向/扩展回归均已验证；全量测试的 23 个范围外历史失败已记录。
