# Codex / OpenCode 隐式子代理统一开关

- 日期：2026-07-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-13
- claim_ttl：本次会话
- handoff_to：

## 背景

工具设置目前只提供工作区级 `codexMultiAgentEnabled`。它默认关闭，并通过 Codex app-server 的 `--disable multi_agent` 与线程配置生效；OpenCode 仍可能按自身默认配置调用子代理。用户要求将其收敛为一个开关，同时控制 Codex 与 OpenCode，默认关闭。

OpenCode 官方文档（2026-07-13 访问）说明主代理可通过 `task` 工具调用 `subagent`，且 `permission.task` 可以设为 `allow` / `ask` / `deny`；官方也确认 `OPENCODE_CONFIG` 是一次性自定义配置覆盖入口：

- https://opencode.ai/docs/agents/
- https://opencode.ai/docs/config/

## 目标

交付一个全局“隐式子代理”开关：默认关闭；关闭时同时禁止 Codex 与 OpenCode 在插件启动的会话中使用内部子代理；开启时同时撤销插件侧禁用策略。

## 范围

- 将面板状态、Webview 控件和消息键统一为 `multiAgentEnabled`，在工具设置全局页展示，并补齐中英文文案。
- 将 `multiAgentEnabled` 保存到全局 `~/.sinitek_cli/settings.json`；旧工作区 `multiAgentEnabled` / `codexMultiAgentEnabled` 只作为迁移输入，全局值优先。
- Codex 保持既有 app-server 禁用路径，默认值显式改为关闭。
- OpenCode 复用现有临时 `OPENCODE_CONFIG` overlay；关闭时在顶层 `permission.task` 写入 `deny`，并以高优先级 `OPENCODE_CONFIG_CONTENT` 内联覆盖重申该拒绝；开启时保持用户原有 OpenCode 权限和默认行为。
- 为持久化迁移、Codex 默认值、OpenCode overlay 和设置消息补充定向单测。
- 更新功能清单、能力规格、运行时参考和本计划的验证记录。

## 非目标

- 不新增或改造 Loop 主从/红蓝多智能体编排。
- 不直接改写 `~/.config/opencode/opencode.json`、`~/.opencode/config.json` 或任何项目 OpenCode 配置。
- 不覆盖用户在开启状态下已配置的 OpenCode `permission.task` 规则。
- 不变更 Claude 的行为。

## 验收标准

- [x] 工具设置全局页只展示一个“隐式子代理 / Implicit Subagents”开关，初始状态为关闭，中文与英文均可用。
- [x] 开关状态以 `multiAgentEnabled` 保存到全局 `settings.json`；旧工作区 `multiAgentEnabled` / `codexMultiAgentEnabled` 值可迁移读取，且全局值优先。
- [x] 关闭时 Codex app-server 收到 `--disable multi_agent`，线程配置包含 `features.multi_agent=false`。
- [x] 关闭时 OpenCode 运行时临时配置保留其他权限和未知字段，并设置顶层 `permission.task="deny"`；`OPENCODE_CONFIG_CONTENT` 以更高优先级阻止项目配置推翻该拒绝。
- [x] 开启时 OpenCode 临时配置不额外改写 `permission.task`，保留用户配置与 OpenCode 默认行为。
- [x] 不会把运行时 OpenCode overlay 写回用户配置文件。
- [x] 相关 TypeScript 构建和定向 Node 测试通过。

## 影响面

- 代码目录：`src/toolSettings.ts`、`src/workspaceSettingsStore.ts`、`src/sessionMessageActions.ts`、`src/panelStateBuilder.ts`、`src/extension.ts`、`src/interactive/`、`src/cli/opencodeconfigmodels.ts`、`src/cli/opencoderuntimeconfig.ts`、`src/webview/`。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`。
- 配置与脚本：运行期间仅创建权限 `0700/0600` 的临时 OpenCode overlay；不持久化外部 CLI 配置改动。

## 风险与缓解

- 风险：全局 OpenCode `permission` 对象被替换，或项目配置覆盖运行时禁用策略。
  - 缓解：关闭时仅浅合并 `permission` 并覆盖 `task`；同时用官方高优先级 `OPENCODE_CONFIG_CONTENT` 内联配置锁定拒绝；开启时不写入该字段；配置文件覆盖层只存于临时目录。
- 风险：从工作区作用域迁到全局作用域时丢失已选值，或后访问的工作区覆盖全局值。
  - 缓解：仅在全局字段缺失时迁移当前工作区有效值；全局字段存在后始终优先，后访问工作区只清理旧字段而不覆盖全局值。
- 风险：Codex 某个未显式传参的调用点仍默认开启。
  - 缓解：将 helper 默认值改为 `false`，并以现有 Codex runner/runtime 测试覆盖参数与配置。
- 风险：OpenCode 官方配置和本机 CLI 版本存在差异。
  - 缓解：仅使用官方文档明确列出的顶层 `permission.task`、`OPENCODE_CONFIG` 和 `OPENCODE_CONFIG_CONTENT`；不依赖未文档化内部文件或 API。

## 验证计划

- 最小相关验证：检查 OpenCode 运行时 JSON overlay 的权限、字段保留和清理；检查 Webview 全局页归属、全局设置归一化和旧 workspace 设置迁移。
- 单元自测命令：`npm run build`，然后运行 Codex runtime、OpenCode runtime/config、设置消息和相关 Webview 定向 Node tests。
- 扩展验证：通过 `node:vm` 解析生成的 Webview 内联脚本；`git diff --check`；JSON/TypeScript 语法检查。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/workspaceSettingsStore.test.ts`、`src/test/multiAgentSettingWebview.test.ts`；更新 Codex runtime、OpenCode runtime/config、设置消息、上下文压缩和 PanelState 定向测试。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/codexRunnerRuntime.test.js dist/test/opencodeconfigmodels.test.js dist/test/opencoderuntimeconfig.test.js dist/test/workspaceSettingsStore.test.js dist/test/sessionMessageActions.test.js dist/test/contextCompactionRunner.test.js dist/test/opencodethinkingintegration.test.js dist/test/multiAgentSettingWebview.test.js` 共 55/55 通过。
- 命名调整复测：界面改名为“隐式子代理 / Implicit Subagents”后，`npm run build` 通过；Codex runtime、OpenCode runtime/config、工作区设置、设置消息和 Webview 定向测试共 42/42 通过。
- 全局作用域调整：控件迁入全局页，`multiAgentEnabled` 迁入 `settings.json`，旧工作区字段仅用于兼容迁移；`npm run build` 通过，ToolSettings、迁移、设置消息、Webview、Codex/OpenCode runtime/config 和上下文压缩定向测试共 68/68 通过。
- 失败处理记录：无测试失败。生成 Webview runtime script 已通过 `node:vm` 语法解析，`git diff --check` 通过。
- 功能清单：已更新现有 Codex multi_agent 能力条目为 Codex / OpenCode 统一“隐式子代理”开关。
- 相关文档同步：已更新能力规格、运行时参考和运行时设计文档，明确全局默认关闭、旧工作区字段迁移、OpenCode 临时/内联覆盖和 Loop 编排边界。

## 任务列表

- [x] 核对当前 Codex 隐式子代理开关、运行链路和 OpenCode runtime overlay。
- [x] 核对 OpenCode 官方 agents/config 文档，确定 `permission.task` 与 `OPENCODE_CONFIG` 策略。
- [x] 实现全局统一设置、旧工作区字段迁移、Codex 默认关闭与 Webview/i18n 改名。
- [x] 为 OpenCode runtime overlay 接入开关，并覆盖所有运行路径。
- [x] 补充定向测试与用户可见能力文档。
- [x] 执行构建、定向测试和差异检查，归档计划。

## 决策记录

- 2026-07-13：开关最终调整为插件全局设置，写入 `~/.sinitek_cli/settings.json`；旧工作区字段只用于一次兼容迁移，不能覆盖已存在的全局值。
- 2026-07-13：OpenCode 关闭时通过顶层 `permission.task: "deny"` 禁止主代理调用子代理；该键是 OpenCode 官方 agents 文档列出的 task 工具权限。由于 `OPENCODE_CONFIG` 低于项目配置优先级，同时以官方 `OPENCODE_CONFIG_CONTENT` 内联配置重申该拒绝。
- 2026-07-13：OpenCode 开启时不主动写 `allow`，而是撤销插件覆盖层对 `task` 的禁止，使用户自己的细粒度权限和 OpenCode 默认行为继续生效；这与 Codex 开启时不额外强制 feature override 的既有语义一致。
- 2026-07-13：用户可见名称改为“隐式子代理 / Implicit Subagents”，与 Loop 的主从/红蓝多智能体编排区分；内部字段继续使用 `multiAgentEnabled`，并从工作区设置迁入全局工具设置。

## 当前结论

已交付用户可见名称为“隐式子代理”的统一全局开关。默认关闭时，Codex 显式禁用 `multi_agent`，OpenCode 同时使用临时 `OPENCODE_CONFIG` 和高优先级 `OPENCODE_CONFIG_CONTENT` 拒绝 `permission.task`；开启时不覆盖用户的 OpenCode task 权限。开关保存在全局 `settings.json`，旧工作区字段仅在全局字段缺失时迁移，并在成功迁移或用户更新全局设置后移除。所有计划内自动化验证通过；未在真实带凭据的 OpenCode 会话中执行端到端调用，运行时配置构造、环境优先级、临时文件清理和面板消息已由定向测试覆盖。
