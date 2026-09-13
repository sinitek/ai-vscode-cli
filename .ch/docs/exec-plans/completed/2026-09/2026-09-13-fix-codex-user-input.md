# 修复 Codex 任务结构化用户输入能力

- 日期：2026-09-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-13
- claim_ttl：same-day

## 背景

Codex 运行任务时会提示当前环境不支持 `request_user_input`，但 Vibe 任务要求在需要澄清时优先使用结构化用户输入机制。需要对照今天的 Codex 日志和当前实现确认能力声明、工具注入或路由是否缺失。

## 目标

让 Codex 任务运行环境在支持结构化用户输入时正确暴露 `request_user_input` 或等价 host user-input 能力，并避免误报“不支持”。

## 范围

- 检查今天的 Codex 日志和相关运行时链路。
- 修复能力声明、工具注入、路由或提示构造中的根因。
- 更新必要测试和用户可见事实来源。

## 非目标

- 不改动 CLI 技术栈、模型供应商或任务协议的大方向。
- 不重构无关任务执行框架。

## 验收标准

- [x] 找到今天日志中 `request_user_input` 不可用提示的直接触发点。
- [x] Codex 任务在需要澄清时能获得结构化用户输入能力，或明确走现有等价机制。
- [x] 相关测试覆盖能力声明或工具注入回归。
- [x] `npm run build` 通过；如相关测试不可运行，记录原因。

## 影响面

- 代码目录：`src/`
- 文档目录：`.ch/docs/`
- 配置与脚本：按实际触发点确认

## 风险与缓解

- 风险：误把不支持交互的非 Codex 环境标记为支持。
- 缓解：按 provider / task kind / host capability 做最小范围修复，并用测试锁定。

## 验证计划

- 最小相关验证：运行与 user input、prompt runtime、Codex task 相关的单测。
- 单元自测命令：按 `.ch/docs/TESTING.md` 选择。
- 扩展验证：`npm run build`。

## 测试与清单同步

- 单元测试新增/更新：`src/test/interactive/codexRunnerRuntime.test.ts`、`src/test/interactive/codexRunnerLifecycle.test.ts`、`src/test/extensionHost/promptInteractiveRuntime.test.ts`、`src/test/core/finalConclusion.test.ts`、`src/test/interactive/codexRunnerSubagent.test.ts`。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/interactive/codexRunnerRuntime.test.js dist/test/interactive/codexRunnerLifecycle.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/core/humanInteraction.test.js dist/test/core/finalConclusion.test.js dist/test/interactive/codexAppServerEvents.test.js dist/test/interactive/codexRunnerSubagent.test.js` 63/63 通过；`node --test dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActions.test.js dist/test/webview/multiAgentSettingWebview.test.js` 73/73 通过；`node --test dist/test/extensionHost/promptParallelRuntime.test.js` 3/3 通过。
- 失败处理记录：未出现失败。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 的 Vibe 人工交互表单和最终答复协议记录。
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/runbooks/PITFALLS.md` 和 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。

## 任务列表

- [x] 定位日志证据和代码触发点。
- [x] 实现结构化用户输入能力修复。
- [x] 增补回归测试并执行验证。
- [x] 判断并同步文档、ontology 或功能清单。

## 决策记录

- 2026-09-13：以日志证据和当前事实来源为准，优先修复能力暴露/路由根因，不做无关框架重构。
- 2026-09-13：真实日志 `/Users/fangjiawei/.codex/sessions/2026/09/12/rollout-2026-09-12T21-58-55-01a095e9-fda8-7292-98da-7f47466abe35.jsonl` 显示 `function_call request_user_input` 后收到 `request_user_input is unavailable in Default mode`；本地 `codex features list` 显示 `default_mode_request_user_input` 默认 `false`。
- 2026-09-13：修复采用最小开启条件：仅 Codex Vibe/coding 且全局 `humanInteractionEnabled=true` 时给 app-server 追加 `--enable default_mode_request_user_input`，并设置 `initialize.capabilities.experimentalApi=true`。
- 2026-09-13：同步补强 Codex 主 turn `turn.completed status="completed"` 的完成信号，避免部分模型 `phase:null` 成功回复被误判为缺少最终结论；该信号只由 runner 确认主线程和当前主 turn 后传递。

## 当前结论

已完成。根因不是“全部分组的 prompt 没注入人工交互要求”，而是 Codex Default mode 自身需要显式 feature flag 才允许 `request_user_input` 工具调用；插件此前只准备了 app-server request 拦截，没有在 Codex app-server 启动和 initialize 阶段同时声明这项能力。

## 验证结果

- `npm run build`：通过。
- `node --test dist/test/interactive/codexRunnerRuntime.test.js dist/test/interactive/codexRunnerLifecycle.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/core/humanInteraction.test.js dist/test/core/finalConclusion.test.js dist/test/interactive/codexAppServerEvents.test.js dist/test/interactive/codexRunnerSubagent.test.js`：63/63 通过。
- `node --test dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActions.test.js dist/test/webview/multiAgentSettingWebview.test.js`：73/73 通过。
- `node --test dist/test/extensionHost/promptParallelRuntime.test.js`：3/3 通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- `git diff --check -- .ch/docs src package.json`：通过。
- `npm run validate:whitespace -- <本次改动文件>`：通过。
