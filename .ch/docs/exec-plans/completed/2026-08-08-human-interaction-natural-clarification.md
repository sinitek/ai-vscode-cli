# Vibe 人工交互自然语言兜底修复

- 日期：2026-08-08
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-08T14:20:00+08:00
- claim_ttl：PT4H
- handoff_to：

## 背景

用户在 Codex Vibe 模式执行“写一首诗，你来问我一些要求帮你更精准写出我想要的诗”时，没有看到人工交互弹窗。日志显示 Codex app-server 没有发出 `item/tool/requestUserInput` 或 `mcpServer/elicitation/request`，而是直接输出普通最终答复形式的问题列表。

## 目标

当全局“人工交互”开启且处于 Codex Vibe/coding 任务时，既支持结构化 app-server 请求，也能对用户明确要求 AI 先询问需求的普通问题列表回复进行兜底：弹出同一人工交互表单，提交后继续当前 Codex 线程，拒绝则终止当前任务。

## 范围

- Codex Vibe/coding interactive runtime。
- 人工交互请求归一化与自然语言问题列表解析。
- 相关单元测试与产品/运行时文档。

## 非目标

- 不改变 Loop/Graph 人工复核机制。
- 不重做 Webview 弹窗主题、组件或设置 UI。
- 不把所有普通问句都自动转弹窗；仅覆盖用户明确要求先询问需求的场景。

## 验收标准

- [x] 结构化 `requestUserInput` / `elicitation` 仍按原逻辑工作。
- [x] 用户明确要求 AI 先问需求，且 Codex 输出问题列表时，会生成人工交互请求。
- [x] 用户提交补充信息后，运行时把补充信息写入当前会话，并继续同一 Codex 线程完成任务。
- [x] 用户拒绝补充信息时，当前任务停止且不进入 hidden retry。
- [x] 相关构建和单元测试通过。

## 影响面

- 代码目录：`src/humanInteraction.ts`、`src/promptRuntime.ts`、`src/extensionHost/promptInteractiveRuntime.ts`、`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`
- 配置与脚本：无

## 风险与缓解

- 风险：误把普通回答中的问题转成弹窗。
- 缓解：要求用户原始 prompt 明确包含“问我/询问我/ask me”与“要求/需求/细节/requirements/details”等澄清意图，且 assistant 回复像问题列表。

## 验证计划

- 最小相关验证：`node --test dist/test/humanInteraction.test.js dist/test/promptRuntime.test.js dist/test/promptInteractiveRuntime.test.js`
- 单元自测命令：`npm run build`
- 扩展验证：`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：`src/test/humanInteraction.test.ts`、`src/test/promptRuntime.test.ts`、`src/test/promptInteractiveRuntime.test.ts`
- 单元自测结果：通过：`npm run build`；`node --test dist/test/humanInteraction.test.js dist/test/promptRuntime.test.js dist/test/promptInteractiveRuntime.test.js`；`node --test dist/test/toolSettings.test.js dist/test/sessionMessageActions.test.js dist/test/multiAgentSettingWebview.test.js`；`git diff --check`
- 失败处理记录：无
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`docs/cli-reference.md`、`docs/vscode_cli_plugin_dev_guide.md`

## 任务列表

- [x] 日志根因确认
- [x] 实现自然语言澄清兜底
- [x] 补充测试
- [x] 同步文档并验证

## 决策记录

- 2026-08-08：采用“双路径”修复：提示词提示 Codex 使用结构化人工交互；运行时兜底识别用户明确要求先询问需求时的普通问题列表回复。

## 当前结论

弹窗未出现的根因是 Codex 没有发结构化人工交互 request；本计划补足自然语言问题列表到人工交互表单的兜底路径。
实现已完成：Codex Vibe prompt 会提示优先使用结构化人工交互；运行时在用户明确要求先询问需求/细节且 assistant 只返回问题列表时，将问题列表转为人工交互表单，提交后继续同一 Codex thread，拒绝则终止当前任务。
