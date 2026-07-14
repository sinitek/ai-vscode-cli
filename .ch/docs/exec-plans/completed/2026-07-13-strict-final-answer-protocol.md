# 固定严格最终答复协议

- 日期：2026-07-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-13
- claim_ttl：本次会话
- handoff_to：

## 背景

工具设置此前提供“最终答复判定”选择器，可在严格 `[final_answer]` 协议与成功回复兼容回退之间切换。用户要求删除该配置，并将普通任务的最终答复判定永久固定为严格协议。

## 目标

普通 Codex、Claude 与 OpenCode 任务只接受结构化最终答复，或当前用户消息之后包含 `[final_answer]` 的非思考助手答复。Codex 的 `turn.completed` 不能再把仅有 commentary 的成功回合提升为最终答复。Loop 的机器协议路径继续使用已有的结构化完成规则，不要求文本标记。

## 范围

- 删除 `finalAnswerPolicy` / `codexFinalAnswerPolicy` 的设置类型、归一化、迁移、持久化和消息处理。
- 删除工具设置中的最终答复策略控件、面板状态字段与 Webview 运行时绑定。
- 将普通任务的显式最终答复要求固定为启用，保留 Loop 豁免。
- 删除 Codex completed-turn commentary 提升逻辑。
- 更新定向测试及当前事实来源文档。

## 非目标

- 不改变 `[final_answer]` 在聊天气泡中的隐藏展示规则。
- 不改变 Loop 的结构化结论、轮次和任务状态协议。
- 不清理历史完成计划中对旧策略的历史记录。

## 验收标准

- [x] 工具设置界面和 `PanelState` 不再暴露最终答复策略。
- [x] 全局 `settings.json` 中遗留的 `finalAnswerPolicy` / `codexFinalAnswerPolicy` 不会影响行为。
- [x] 普通任务固定要求结构化最终信号或 `[final_answer]` 文本标记。
- [x] Codex 的 completed commentary 不会被合成为 `codexFinalAnswer`。
- [x] Loop 机器协议路径仍不要求文本标记。
- [x] TypeScript 构建、相关 Node 单测和 `git diff --check` 通过。

## 影响面

- 代码目录：`src/toolSettings.ts`、`src/extension.ts`、`src/panelStateBuilder.ts`、`src/sessionMessage*.ts`、`src/interactive/`、`src/webview/`。
- 测试目录：`src/test/` 中的设置、终结判定、Codex runner、Webview 和面板状态用例。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/runbooks/PITFALLS.md`。

## 风险与缓解

- 风险：仅移除 UI 而留下兼容回退，使旧配置仍可放宽协议。
  - 缓解：同时删除存储归一化、运行时策略分支与 Codex completed-turn 提升。
- 风险：把 Loop 的结构化机器协议误纳入文本标记要求。
  - 缓解：固定判定函数仅以 `lobsterTaskId` 区分普通任务和 Loop 路径，并保留对应回归测试。
- 风险：覆盖前序全局“隐式子代理”和自动压缩设置改动。
  - 缓解：只改最终答复相关行，构建前检查差异。

## 验证计划

- 最小相关验证：构建后运行终结判定、prompt runtime、Codex runner、设置、会话消息、面板状态及 Webview 测试。
- 单元自测命令：`npm run build`，随后以编译产物运行定向 `node --test`。
- 扩展验证：`git diff --check`；必要时检查不含本次修改的现有失败是否为历史问题。

## 测试与清单同步

- 单元测试新增/更新：移除策略选择和 completed-turn 回退断言；增加遗留设置忽略与严格协议回归断言。
- 单元自测结果：`npm run build` 通过；定向 `node --test` 覆盖最终答复、prompt、Codex runner、OpenCode 结构化终态、设置消息、PanelState 和 Webview，共 131/131 通过。
- 失败处理记录：无本次范围内失败。
- 功能清单：已同步为“最终答复固定严格协议”。
- 相关文档同步：已更新能力规格、运行时参考和 `PITFALLS.md`；`media/official_skills_catalog.json` 的所有 description 中文校验通过。

## 任务列表

- [x] 核对当前实现、CodeGraph 影响面与执行计划。
- [x] 移除最终答复策略配置并固定严格 `[final_answer]` 判定。
- [x] 同步 Webview、测试与事实文档。
- [x] 构建、运行相关测试并归档执行计划。

## 决策记录

- 2026-07-13：不保留 `successful_reply_fallback`，普通任务的严格判定不再由用户配置控制。
- 2026-07-13：Loop 继续以结构化机器协议完成，不强制自然语言 `[final_answer]` 标记。

## 当前结论

已完成。CodeGraph 状态提示当前工作树存在索引滞后，因此实现和验证均以直接读取源码/编译产物为准。普通任务已固定为结构化终态或 `[final_answer]` 文本标记收口；旧策略字段被忽略，Codex completed commentary 不再获得合成 final 标记。`npm run build`、131 项定向 Node 测试、`git diff --check` 和官方技能目录 description 中文校验均已通过。
