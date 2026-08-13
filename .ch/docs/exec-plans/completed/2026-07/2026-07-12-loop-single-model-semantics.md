# Loop 单一执行模型语义

- 日期：2026-07-12
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-12
- claim_ttl：当前会话
- handoff_to：无
- completed_at：2026-07-12

## 背景

Loop 当前沿用“主任务模型 / 子任务模型”双选择，但用户确认主任务和子任务不应再拥有不同模型。Claude 不支持插件侧模型选择；Codex 的所有 Loop 角色应使用同一个模型；OpenCode 的大模型和小模型是 OpenCode 自身运行时能力，与 Loop 主从角色无关，必须保持现状。

同时，OpenCode `text` JSONL 可能混入 `<thinking>...</thinking>` 等内部标签，需要在实时展示、最终答复和历史消息中统一清理。

## 目标

- Loop 模式不再暴露通用“主模型 / 子模型”双选择语义。
- Claude Loop 不显示模型选择控件。
- Codex Loop 只显示一个模型选择，并让所有主任务、子任务和辩论角色使用该模型。
- OpenCode 继续显示自身的大模型 / 小模型与对应思考力度，不映射为 Loop 主从模型。
- 思考 wrapper 标签不出现在可见气泡或最终答复中。

## 范围

- Webview 模型区域、消息 payload 和工作区模型状态。
- Loop 输入快照、主任务/子任务/辩论任务模型解析与 Codex 启动参数。
- Claude / Codex / OpenCode 的模式切换显示规则。
- 思考标签解析、历史消息修复、回归测试和事实文档。

## 非目标

- 不改变 OpenCode `model` / `small_model` 的官方语义。
- 不新增 Claude 模型管理或 `--model` 参数。
- 不替换现有 CLI、Runner 或 Loop 编排框架。

## 验收标准

- [x] Claude 选择 Loop 后不显示任何模型选择控件。
- [x] Codex 选择 Loop 后只显示一个模型选择控件。
- [x] Codex Loop 主任务、子任务、裁判与参与者全部收到同一个模型。
- [x] OpenCode 在 coding / Loop 中继续显示大模型和小模型，不出现 Loop 主/子模型文案。
- [x] 旧的主/子模型持久化值不再影响新 Loop 任务，并保持兼容读取不崩溃。
- [x] `<thinking>` / `<think>` / `<analysis>` / `<reasoning>` wrapper 不出现在可见输出或最终答复中。
- [x] 相关单测、完整 TypeScript 构建和全量测试通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/sessionMessageActions.ts`、`src/modelSelectionStore.ts`、`src/webview/`、`src/loop*`、`src/interactive/`、`src/cli/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/design-docs/`、`.ch/docs/runbooks/`
- 配置与脚本：兼容现有 `~/.sinitek_cli/` 模型状态，不迁移外部 CLI 配置

## 风险与缓解

- 风险：仅隐藏 UI，但运行时仍读取旧子模型字段。
- 缓解：从 Loop 输入创建到所有角色启动逐层断言 effective model，新增主/子任务相同模型测试。
- 风险：误把 OpenCode `small_model` 当作 Loop 子任务模型移除。
- 缓解：OpenCode 路径继续使用独立 primary/small runtime overlay，测试 coding 与 Loop 均保留双模型。
- 风险：广泛删除尖括号内容会破坏正常 HTML 或代码。
- 缓解：只识别四种内部思考 wrapper 标签，普通 `<div>` 等内容保持原样。

## 验证计划

- 最小相关验证：Loop Webview、模型状态、消息路由、Codex Runner、OpenCode parser、历史消息清洗测试。
- 单元自测命令：`node --test dist/test/opencodeloopmodewebview.test.js dist/test/opencodedualmodelwebview.test.js dist/test/sessionMessageActions.test.js dist/test/codexRunnerRuntime.test.js dist/test/opencodeCommandRunner.test.js dist/test/codexReasoningContent.test.js`
- 扩展验证：`npm run build`、`node --test dist/test/*.test.js`、`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：已完成。
- 单元自测结果：定向测试 76/76 通过；全量测试 384/384 通过。
- 失败处理记录：无。
- 功能清单：已同步 Claude 无模型选择、Codex 单模型、OpenCode 大小模型独立语义及思考 wrapper 清洗。
- 相关文档同步：已同步能力说明、运行时参考、设计文档、兼容入口和踩坑记录。
- 验证命令：`npm run build`；`node --test dist/test/*.test.js`；`git diff --check`。

## 任务列表

- [x] 定位 OpenCode 思考标签污染与清洗链路。
- [x] 梳理 Loop 模型 UI、状态和启动链路。
- [x] 实现 Claude 无选择、Codex 单模型、OpenCode 双模型保持。
- [x] 更新测试与文档并执行全量验证。

## 决策记录

- 2026-07-12：用户明确取消 Loop 主模型 / 子模型差异，Codex 所有 Loop 角色统一使用一个模型。
- 2026-07-12：Claude 不提供插件侧模型选择；OpenCode 大模型 / 小模型是 CLI 自身能力，不属于 Loop 主从角色。
- 2026-07-12：内部思考 wrapper 仅做定向解析和去标签，不做通用 HTML 清洗。

## 当前结论

Loop 模型语义已按 CLI 能力统一：Claude 无插件侧模型选择，Codex 全部 Loop 角色共用一个模型，OpenCode 保持自身 primary/small 双模型。内部思考 wrapper 已在实时输出、最终答复和历史消息中定向清洗；完整构建、384 项全量测试和差异检查均通过。
