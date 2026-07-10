# 通用 final_answer 文本标记兜底

- 日期：2026-07-10
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-10
- claim_ttl：本次会话
- handoff_to：

## 背景

上一轮针对 Codex app-server 缺少 `phase:"final_answer"` 的真实事件序列，新增了成功回合 commentary 提升策略。但这种仅依赖 Codex `turn.completed` 的兼容方式不能覆盖 Claude 和 OpenCode，也会把过程性 commentary 当成最终答复。

用户提出统一约定：模型完成任务时让最终回复包含 `[final_answer]`；插件在没有结构化 `final_answer` 类型消息时，把包含该标记的非 thinking assistant 文本视为最终答复。全局默认恢复为严格判定。

## 目标

- 所有需要人类最终答复气泡的普通任务提示和 hidden retry 提示都追加统一的 `[final_answer]` 最终回复约定，不改变界面展示的原始用户问题；Loop 等机器协议显式豁免。
- 结构化 final answer 仍为最高优先级；缺少结构化类型时，Codex、Claude、OpenCode 都可通过 assistant 文本中的 `[final_answer]` 收口。
- AI 对话气泡只在 Webview 渲染层隐藏 `[final_answer]`；原始 assistant 内容保留该标记供判定、续接和存档使用。
- 全局最终答复策略默认 `strict_final_answer`；严格模式只接受结构化 final 或文本标记。
- 兼容模式保留成功退出后接受普通非空 assistant 答复的能力，其中 Codex 继续支持 completed-turn 原位提升。
- 兼容读取上一版 `codexFinalAnswerPolicy`，持久化和 Webview 对外使用通用 `finalAnswerPolicy`。

## 范围

- 共享提示构建与最终结论判定。
- Codex / Claude 交互模式和 OpenCode one-shot / parallel 模式的终态检查。
- 全局工具设置、PanelState、Webview 控件和中英文文案。
- 单元测试、产品规格、CLI runtime reference 与 PITFALLS。

## 非目标

- 不修改各 CLI 的协议或上游事件格式。
- 不移除 Codex 结构化 `phase:"final_answer"` 支持。
- 不改变 hidden retry 次数、间隔和错误展示。
- 不从 thinking、trace、system 或 user 文本识别 `[final_answer]`。

## 验收标准

- [x] `buildThinkingPrompt` 和 `buildHiddenRetryPrompt` 对 Codex、Claude、OpenCode 普通任务都附带最终回复必须以 `[final_answer]` 开头的约定，Loop 机器协议可显式关闭。
- [x] 严格模式接受结构化 Codex final answer，或用户锚点之后包含 `[final_answer]` 的非 thinking assistant 消息。
- [x] Webview assistant 气泡不显示 `[final_answer]`，且不会修改原始消息或 user 气泡。
- [x] 严格模式拒绝无标记普通答复、thinking/trace 中的标记和旧消息中的标记。
- [x] 兼容模式继续接受成功退出后的普通非空 assistant 答复，并保留 Codex completed-turn fallback。
- [x] 全局设置默认严格模式，UI 中英文文案明确覆盖所有 CLI；旧 Codex 设置可迁移读取。
- [x] Node build、最小相关测试和扩展回归通过，范围外历史失败有证据记录。
- [x] 功能清单、能力规格、runtime reference 和复发问题记录与实现一致。

## 影响面

- 代码目录：`src/promptRuntime.ts`、`src/finalConclusion.ts`、`src/toolSettings.ts`、`src/extension.ts`、`src/sessionMessageActions.ts`、`src/panelStateBuilder.ts`、`src/webview/`
- 测试目录：`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/runbooks/`
- 配置与脚本：`~/.sinitek_cli/settings.json` 字段兼容迁移

## 风险与缓解

- 风险：用户正文或引用代码中偶然包含 `[final_answer]` 被误判。
- 缓解：只检查当前用户消息之后的非 thinking assistant 消息；提示要求仅在最终回复使用该标记。按用户要求检测位置使用“包含”语义，不强制解析为首字符。
- 风险：CLI 忽略提示，严格默认导致自动继续。
- 缓解：保留可选兼容策略；hidden retry 也重复标记约定。
- 风险：已有上一版全局设置失效。
- 缓解：读取时把旧 `codexFinalAnswerPolicy` 和旧 `completed_turn_fallback` 值迁移到通用字段和值。

## 验证计划

- 最小相关验证：`npm run build && node --test dist/test/finalConclusion.test.js dist/test/promptRuntime.test.js dist/test/finalAnswerPolicy.test.js dist/test/codexRunnerRuntime.test.js dist/test/toolSettings.test.js dist/test/sessionMessageActions.test.js`
- 单元自测命令：同上。
- 扩展验证：运行其余编译后 Node test；对既有历史失败分类记录。
- 静态核验：`git diff --check`；确认 `media/official_skills_catalog.json` description 保持中文。

## 测试与清单同步

- 单元测试新增/更新：新增 `promptRuntime.test.ts`；把策略测试泛化为 `finalAnswerPolicy.test.ts`；更新 `finalConclusion`、工具设置、消息设置持久化、PanelState 和 Codex completed-turn 回归。
- 单元自测结果：`npm run build` 通过；加入 Webview 展示过滤回归后的最小相关回归 47/47 通过，补充 Webview 回归 31/31 通过；排除两个已知失败文件后的上一轮扩展回归 336/336 通过。
- 失败处理记录：首次扩展回归被重命名前遗留的 `dist/test/codexFinalAnswerPolicy.test.js` 重复执行，产生 2 个过期断言失败；删除该生成产物后通过。加入展示过滤测试后的最终全量为 392 项、369 通过、23 失败，仍集中在未改动的 `configService.test.js` 1 项和 `lobsterBoundaryRecord.test.js` 22 项，归类为范围外历史失败。
- 功能清单：已把 Codex 专属条目泛化为所有 CLI 的显式最终答复协议与策略。
- 相关文档同步：已更新能力规格、CLI runtime reference 和 `PITFALLS.md`；`media/official_skills_catalog.json` 未修改，全部 description 中文检查通过。
- 记忆金字塔检查：通用行为已进入产品规格，复发根因与机器协议豁免已进入 `PITFALLS.md`；无需在热区记忆重复维护同一事实。

## 任务列表

- [x] 检查上一版 Codex 策略、所有 CLI 提示构建与终态检查路径。
- [x] 实现通用文本标记提示和集中式判定。
- [x] 泛化全局策略并将默认值改为严格。
- [x] 补齐三类 CLI、设置迁移和 Webview 测试。
- [x] 执行构建/回归，更新文档并归档计划。

## 决策记录

- 2026-07-10：保留结构化 `final_answer` 的最高优先级；文本标记仅是协议缺失时的通用兜底。
- 2026-07-10：严格模式并非只接受上游事件类型，而是接受“结构化 final 或 `[final_answer]` assistant 文本”；兼容模式才接受没有任何显式终态信号的普通成功答复。
- 2026-07-10：设置对外命名泛化为 `finalAnswerPolicy`，读取旧 Codex 专属字段完成向前迁移。
- 2026-07-10：OpenCode 成功返回正文但缺少标记时，严格模式使用专门错误说明，不再误报“没有返回助手回答”。
- 2026-07-10：Loop 等机器协议显式关闭标记注入和严格文本判定，避免 `[final_answer]` 破坏纯 JSON 决策；通用策略只约束需要人类最终答复气泡的普通任务。
- 2026-07-10：标记隐藏属于纯展示规则；Webview 基于 assistant 消息生成过滤后的 Markdown 输入，不能改写 `message.content`，避免严格判定与历史恢复失效。

## 当前结论

已完成。默认严格策略在三种 CLI 普通任务上统一接受结构化 final 或 `[final_answer]` assistant 文本，普通任务首轮与 hidden retry prompt 都注入标记约定；Webview assistant 气泡隐藏协议标记但保留原始消息；Loop 等机器协议保持原有结构化终态，兼容策略和旧设置迁移保留。实现、国际化、事实来源、Node build、最小回归与扩展回归均已验证，全量测试的 23 个范围外历史失败已记录。
