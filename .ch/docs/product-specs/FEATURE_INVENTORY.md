# 功能总表

这个文件是当前仓库功能清单的**单一事实来源**。

作为 starter，这里默认从空表开始；当首个真实能力进入规划或实现时，再新增条目。

## 更新规则

- 新增能力时新增一行。
- 修改已有能力时更新状态、角色、规格来源、测试状态和备注。
- 下线能力时不要直接删除，改成 `removed` 并保留历史说明。
- 如果一个功能变更无法直接链接到规格，至少要能链接到执行计划或设计文档。
- 不要让 README、聊天记录、任务单、临时表格分别维护不同版本的功能列表。

## 什么时候必须更新

- 新增用户可感知能力、后台能力、运维能力或平台能力。
- 修改已有能力的行为、权限、流程、入口、状态或适用角色。
- 能力进入暂停、废弃、替换、下线状态。
- 需求没有新增页面，但改变了导入导出、通知、审计、报表或批处理能力。

## 状态枚举

- `proposed`：已识别，但尚未进入实施
- `in-progress`：正在建设
- `active`：已经交付且当前生效
- `deprecated`：仍存在，但不建议继续使用
- `removed`：已下线，仅保留历史记录

## 维护边界

- 功能名描述用户或系统能力，不直接使用页面名或接口名。
- 测试状态只回答是否有基础自动化护栏，不替代测试报告。
- 执行计划应说明本次是否需要更新本表；收尾说明应记录实际变更项。

## 当前清单

starter 默认不预置功能项。复制模板后，请从第一个真实能力开始维护下表。

| 业务域 | 功能名称 | 状态 | 主要角色 | 规格来源 | 实现位置 | 测试状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AI 对话 / 记忆 | Harness 骨架开关与踩坑记录 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/LONG_TERM_MEMORY_DESIGN.md` | 工具设置、prompt 构建、当前工作区 `.ch/.agents` harness scaffold、`AGENTS.md`、`CLAUDE.md`、`.gitignore` 的 `.codegraph/` 忽略项、`ARCHITECTURE.md` AI 初始化任务、`.ch/docs/memory/`、`.ch/docs/runbooks/PITFALLS.md`、CodeGraph 终端初始化 | `npm run build`；`node --test dist/test/toolSettings.test.js dist/test/memoryRuntimeGate.test.js dist/test/longTermMemory.test.js` | 默认关闭；开启时先确认，确认后补齐工作区 harness scaffold、确保 `.codegraph/` 被 git 忽略，并启动 CodeGraph 设置；收尾阶段可二次确认并复用当前 AI 对话以 coding 模式初始化 `ARCHITECTURE.md`；`PITFALLS.md` 记录带根因/规避/验证线索的失败、阻塞、回滚或明确踩坑总结；关闭后只允许查看/导出/删除，不控制 Codex / Claude / OpenCode 外部 CLI 自带记忆或历史 |
| AI 对话 / Codex | Codex 官方 multi_agent 开关 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md` | 工具设置、Codex app-server 启动参数、Codex thread config、工作区设置 `codexMultiAgentEnabled` | `npm run build`；`node --test dist/test/codexRunnerRuntime.test.js` | 默认关闭；关闭时扩展显式禁用 Codex 官方 `multi_agent` 功能；开启时 Codex 可按自身运行时行为使用内置子智能体能力；该设置只影响 Codex |
| AI 对话 / 通用 | 最终答复显式协议与判定策略 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md` | 全局工具设置 `finalAnswerPolicy`、`src/finalAnswerProtocol.ts`、共享 prompt 构建、Codex app-server 回合事件适配、最终结论气泡判定 | `npm run build`；`node --test dist/test/finalAnswerPolicy.test.js dist/test/promptRuntime.test.js dist/test/finalConclusion.test.js dist/test/codexRunnerRuntime.test.js dist/test/toolSettings.test.js dist/test/sessionMessageActions.test.js` | 默认 `strict_final_answer`：结构化 final 类型优先；没有结构化类型时，Codex / Claude / OpenCode 当前用户消息之后包含 `[final_answer]` 的非 thinking assistant 文本也视为最终答复。普通任务 prompt 和 hidden retry prompt 都要求模型仅在完成任务后的最终回复以该标记开头；Loop 等内部机器协议继续使用自身结构化终态，不注入或要求文本标记。可切换 `successful_reply_fallback`，额外接受成功退出后的普通助手答复；旧 `codexFinalAnswerPolicy=completed_turn_fallback` 自动迁移到兼容策略 |
| AI 对话 / Codex | 推理摘要空注释精准清洗 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/codexReasoningContent.ts`、Codex app-server reasoning 解析、Codex thinking 会话清洗 | `npm run build`；`node --test dist/test/codexReasoningContent.test.js dist/test/codexAppServerProtocol.test.js dist/test/codexRunnerRuntime.test.js` | 仅从 Codex reasoning/thinking 内容移除独占一行的空 HTML 注释 `<!-- -->`（含水平空白变体）；普通 assistant/user 内容、行内空注释和非空 HTML 注释保持原样；加载历史 Codex 会话时同步清理已落盘残片 |
| AI 对话 / 会话 | 当前会话提示词倒序查看 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | 对话运行状态区“提示词”按钮、当前会话消息运行态、提示词弹层 | `npm run build`；`node --test dist/test/runPromptHistoryWebview.test.js` | 仅展示当前 tab 会话的非空用户输入；按 `createdAt` 倒序，缺少时间时按消息顺序倒序；最新提示词置顶 |
| AI 对话 / OpenCode | OpenCode CLI、会话续接与配置驱动双模型 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md` | AI 对话 CLI 分组、OpenCode JSONL `sessionID` 提取、tab 会话接管、active config 模型解析、主模型/小模型下拉、按配置隔离的角色覆盖、运行时 config overlay、会话存档 | `npm run build`；`node --test dist/test/opencodeCommandRunner.test.js`；OpenCode parser/Webview/runner/runtime/store/config example tests | 首轮接管真实 `ses_*`，后续同 tab 通过 `--session` 续接；`local_*` 只用于插件消息暂存且不会传给 CLI，旧占位会话捕获新真实 ID后迁移消息和 tab 引用；候选只从 active config 的 `provider.<id>.models` 加载且无管理入口；聊天区仅显示两个紧凑 select 和错误区域，无可见角色 label、思考力度说明或“跟随配置”option，正常 option 只显示 `models.<id>.name`（缺失时回退 model id）；选择配置默认 ref 会清除临时覆盖，其他项发送 exact ref；普通、并行、Loop 主/子任务、续跑和唤醒统一使用 effective primary，小模型仅进入随机 `OPENCODE_CONFIG` overlay；覆盖按 config id 隔离并清理失效值，overlay 权限为目录 `0700`/文件 `0600`，exit/error/timeout/cancel 后清理且不改写用户配置 |
| AI 对话 / OpenCode | coding / Loop 双模式入口 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md` | 对话面板模式选择器、`src/sessionMessageActions.ts`、Loop 主任务/子任务/多轮复核/群聊编排、active config effective primary 运行链路 | `npm run build`；OpenCode Loop 模式入口与路由回归测试 | OpenCode 可在对话面板选择 coding 或 Loop；Loop 复用既有主任务、子任务、多轮和群聊链路，并通过非交互式 one-shot `opencode run` 执行。该能力不表示 `isInteractiveSupported(opencode)=true`，不启用 Codex/Claude interactive runner 或 common command；OpenCode 不使用 Codex 专用主/子任务模型分配，所有对话和 Loop 请求使用下拉选择的 effective primary，小模型仅供 OpenCode 内部轻量请求 |
| AI 对话 / Loop | Loop 主任务 Tab 生命周期运行态 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md` | `src/sessionTabs.ts`、`src/extension.ts`、`src/webview/viewContentScript/messageRendering.ts` | `npm run build`；`node --test dist/test/conversationTabLock.test.js` | Loop 主任务记录仍为 `running` 时，主 Tab 持续显示运行态并保持不可关闭，不依赖当前是否存在 AI/CLI 执行进程；完成、人工复核、错误或停止后解除 |
| AI 对话 / Loop | Loop 群聊用户发言气泡 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/lobsterDebate.ts`、`src/panelDiagnostics.ts`、`src/webview/lobsterDebatePanel.ts`、`src/webview/lobsterDebatePanelRenderer.ts`、`src/webview/lobsterDebatePanelStyles.ts` | `npm run build`；`node --test dist/test/lobsterDebate.test.js dist/test/lobsterDebatePanel.test.js` | 未完成且可补充需求的 Loop 任务显示“我要说话”；提交内容继续写入任务记录和主通信文件，刷新后在群聊时间线右侧显示“我”的对话气泡，并隐藏内部时间和轮次元数据 |
| AI 对话 / OpenCode | 精确主模型动态推理 variant | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md` | `src/cli/openCodeModelCapabilities.ts`、`src/modelSelectionStore.ts`、`src/panelStateBuilder.ts`、`src/extension.ts`、`src/cli/commandRunner.ts`、Webview thinking selector | `npm run build`；相关 OpenCode resolver/config/Webview/runner/action/integration tests | 主模型 variants 只来自精确模型 CLI metadata 或当前配置显式声明，由 `--variant` 选择；小模型内部请求忽略 variants 并使用自身 options；未知模型 Default-only，不按 npm/provider/model 名猜测，`--thinking` 仅控制 thinking blocks |
| AI 对话 / Gemini | Gemini CLI 支持下线 | removed | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md` | 旧 AI 对话 Gemini 分组、旧配置中心 Gemini 卡片、旧 `geminiStreamJson` / catalog 路径 | 文档校验：`rg -n "Gemini\|gemini" <授权文档>`；源码验证由对应实现子任务负责 | Gemini 已从当前 AI 对话和配置中心支持范围移除；旧路径和脚本只作为历史迁移或审计参考，不再作为当前支持 CLI |
| AI 对话 / 上下文 | 执行后自动压缩上下文 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | 工具设置、`src/contextCompactionRunner.ts`、`src/extension.ts`、Codex/Claude/OpenCode interactive runner | `npm run build`；`node --test dist/test/contextCompactionRunner.test.js` | 默认开启；仅成功结束且执行超过 5 分钟的已有会话触发；自动压缩为静默后台任务，不追加普通任务完成耗时气泡、不覆盖刚完成任务的真实执行时间；手动压缩仍显示压缩运行状态；OpenCode 的具体压缩路径以当前实现为准 |
| 配置 / 配置中心 | CLI 配置档案管理与卡片级保存 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | 配置中心 webview、`media/config/assets/config-app-ui.js`、`src/config/configService.ts`、`src/webview/configPanel.ts` | `npm run build`；`node --check media/config/assets/config-app-ui.js`；`node --test dist/test/claudeConfigVisualEditor.test.js`；`src/test/opencodeconfigvisualeditor.test.ts`；`src/test/opencodeconfigexample.test.ts` | 支持配置档案列表、排序、激活、删除、初始化、备份、导出、Skills 和 MCP 管理；Claude 卡片管理 `~/.claude/settings.json`，默认使用可视化编辑器并可切换高级 JSON，覆盖官方常用模型、推理、行为、权限与 API/网关字段，重点支持 `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL`，未知字段和额外环境变量保留，无效 JSON 不覆盖有效状态；OpenCode 只维护 `~/.opencode/config.json`，不提供 `.env` 第二保存入口；OpenCode 卡片默认使用 Provider 列表 + 模型列表的可视化编辑器，并可切换高级 JSON；可编辑 Provider id/name/npm/baseURL/apiKey、模型 id/name/reasoning、主/小角色和逗号分隔思考力度，首项写 `options.reasoningEffort`、全部生成简单 variants；重命名同步角色 ref，悬空引用阻止保存，未知顶层/provider/model/options/复杂 variants 保留，无效 JSON 不覆盖有效可视化状态；范例导入后立即加载可视化；Gemini 配置入口已移除 |
