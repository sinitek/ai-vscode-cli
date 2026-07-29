# Codex Loop/Graph 主从模型与思考力度传递

- 日期：2026-07-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-29
- claim_ttl：本轮会话
- handoff_to：无

## 背景

用户要求 Codex 任务能力与 OpenCode 任务保持一致：Loop 模式和 Graph 模式都要支持主从模型，并分别配置、传递主模型与从模型的思考力度。

## 目标

让 Codex 在普通运行、Loop 主从任务、Graph 节点执行中正确使用对应角色的模型与思考力度，避免子任务沿用主任务模型或主任务思考力度。

## 范围

- 检查现有 OpenCode 主从模型和思考力度链路。
- 补齐 Codex 对 Loop/Graph 角色模型和角色思考力度的选择、存储、运行时传参。
- 更新相关测试和必要产品/设计文档。

## 非目标

- 不替换 Codex/OpenCode/Claude CLI 技术栈。
- 不重构 Loop 或 Graph 调度核心。
- 不改变已有 OpenCode 模型配置语义。

## 验收标准

- [x] Codex Loop 主任务和子任务可分别选择模型，并在执行时传给 CLI。
- [x] Codex Loop 主任务和子任务可分别使用思考力度，子任务仍受全局子任务上限约束。
- [x] Codex Graph 主/从节点执行时使用正确角色模型和思考力度。
- [x] OpenCode 现有行为不回退。
- [x] 相关测试与构建通过，文档同步完成。

## 影响面

- 代码目录：`src/extension.ts`、`src/modelSelectionStore.ts`、`src/cli/`、`src/graph/`、`src/webview/`、`src/test/`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`docs/`
- 配置与脚本：无计划变更。

## 风险与缓解

- 风险：当前工作区已有未提交改动，目标文件可能包含用户修改。
- 缓解：修改前读取具体上下文，只做局部补丁，不回退无关改动。

## 验证计划

- 最小相关验证：针对模型选择、Loop/Graph runtime 的相关单测。
- 单元自测命令：`npm run build`；相关 `node --test dist/test/*.test.js`。
- 扩展验证：`git diff --check`、必要时 `codegraph sync`。

## 测试与清单同步

- 单元测试新增/更新：已更新 `sessionMessageActions`、Codex dual model Webview、clipage runtime、Loop subtask thinking、Graph runtime 和 OpenCode role model 相关测试；补充 Graph 和手动子任务续跑的 Codex 思考力度传参断言。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/sessionMessageActions.test.js dist/test/sessionMessageActionsCoreCoverage.test.js dist/test/loopSubtaskThinking.test.js dist/test/codexdualmodelwebview.test.js dist/test/clipagescriptruntimecoverage.test.js dist/test/graphExtensionRuntime.test.js dist/test/opencoderolemodelruntime.test.js dist/test/opencodethinkingintegration.test.js dist/test/cliPageStaticRenderCoverage.test.js` 95/95 通过；`git diff --check` 通过。
- 失败处理记录：未出现失败；`clipagescriptruntimecoverage` 的 Webview 错误日志为测试用例主动触发的错误上报覆盖，测试通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `docs/插件功能清单.md`。
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`；现有 Graph/OpenCode 相关文档变更保持既有事实来源口径。

## 任务列表

- [x] 使用 CodeGraph 定位模型与思考力度链路。
- [x] 补齐 Codex Loop/Graph 角色模型与思考力度运行时传递。
- [x] 更新测试覆盖 Codex 主从模型和思考力度。
- [x] 同步文档并执行验证。

## 决策记录

- 2026-07-29：保持 OpenCode 现有配置语义，优先复用现有 `selectedLoopByConfigId` / `loopRolesByConfigId` 角色模型结构扩展 Codex。
- 2026-07-29：Codex 角色思考力度按 active config + role + model 存储；普通 Coding 继续使用单模型思考力度，Loop/Graph 发送 `loopMainThinkingMode` / `loopSubtaskThinkingMode`，Loop 子任务运行时继续受全局 `loopSubtaskMaxThinkingMode` 上限约束。

## 当前结论

已完成 Codex Loop/Graph 主/子模型与主/子思考力度传递，覆盖 Webview 状态、消息 payload、模型存储、Loop 运行、Graph 节点执行、手动子任务续跑唤醒和文档事实来源。构建、相关测试和 diff whitespace 校验均通过；无未决问题。
