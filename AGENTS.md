# 项目规则

本项目是 VS Code 插件：在 VS Code 中提供内置 AI 对话面板，调用本地 CLI（如 `codex` / `claude` / `opencode`）执行对话请求并展示结果。

根级 `AGENTS.md` 只保留稳定硬约束和导航入口；细节知识放进 `.ch/docs/`、`.agents/skills/` 或更近的局部 `AGENTS.md`。

## 项目硬约束

- 技术栈、框架和关键基础设施按现有版本执行；变更需先获得明确批准。
- 禁止无关大改；实现要贴近根因，代码遵循去魔法、强约定、可检索、可复用的 AI 友好规范。
- 优先复用已有功能、组件、API、脚本、样式和测试夹具，避免重复建设。
- 不把密钥、令牌、生产地址、客户数据或运行时私有数据写入仓库。
- 本插件支持中英文国际化，新增或修改用户可见功能时必须同步 i18n 文案。
- Web 界面优先使用项目已有样式；如果已有主题，不允许硬写颜色样式，必须使用主题提供的语义化写法。
- Node / TypeScript 代码改动后按 `.ch/docs/TESTING.md` 从最小相关范围开始验证，至少确认 `npm run build` 不报错；相关单测失败要先分类再修复或记录。
- 数据库结构变化（如有）必须同步相关 SQL 配置文件，全量和增量脚本都要覆盖，建表脚本必须包含表和字段中文备注。
- 用户可见功能、行为、权限、流程或验收变化时，同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 或明确记录无需更新的理由。
- 如修改内置/官方 skills 或其 catalog，确认 `media/official_skills_catalog.json` 中的 `description` 保持中文。

## 项目入口

- CLI 助手调用手册：`docs/cli-reference.md`、`docs/VSCODE_CLI_PLUGIN_DEV_GUIDE.md`。
- CLI 运行时事实来源：`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/runbooks/local-development.md`。
- 功能清单入口：`docs/插件功能清单.md`；详细事实来源为 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 和 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 文档总入口：`.ch/docs/README.md`。
- 架构边界：`ARCHITECTURE.md`。
- 测试规则唯一入口：`.ch/docs/TESTING.md`。
- 工具风险边界：`.ch/docs/TOOL_POLICY.md`。
- 本工具运行数据：`~/.sinitek_cli/`。

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

<!-- BEGIN CODEX HARNESS RULES -->
## Codex harness 通用规则

> 以下是受管 harness 入口块。同步模板时应保持“根级只做导航，细节回到事实来源”的轻量原则。

### 执行路由

- 非平凡任务必须使用任务列表；任务列表固定使用 `Tasklist:` 标题和 `[pending]`、`[in_progress]`、`[completed]` 状态，任务描述用中文。
- 需求不清时使用结构化 user-input / elicitation 机制提问，最多 3 个短问题；每个问题只解决一个决策，并优先给出 2-3 个互斥选项。
- 大范围、跨模块、跨阶段或高风险任务使用 `execution-plan` skill，并按 `.ch/docs/exec-plans/README.md` 管理执行计划。
- 上下文分散或中断恢复时使用 `memory-recall` skill；不要手工通读全部历史文档。
- 业务概念、权限、状态机、所有权、跨域流程或事实来源判断先使用 `ontology` skill；命中后必须打开 `source_refs` 核对当前事实来源。
- 代码位置、调用链、影响面和架构探索优先使用 CodeGraph；CodeGraph 不替代直接读取待编辑文件、编译、测试或运行验证。
- 工具使用边界以 `.ch/docs/TOOL_POLICY.md` 为准；skills 和 MCP 只按任务需要启用，保持低噪音。

### 实施规则

- 先查已有实现和事实来源，再改代码；禁止基于猜测的数据结构、配置、事件或外部接口继续开发。
- 稳定业务逻辑变更默认补或更新相关单元测试；修复 bug 时补回归测试。
- 用户可见功能、行为、权限、流程或验收变化时，同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 或明确记录无需更新的理由。
- 行为、接口、架构、运维方式变化时，同步对应设计文档、运行手册或局部 `AGENTS.md`。
- 发现真实踩坑、隐式前置条件或高复发问题时，沉淀到 `.ch/docs/runbooks/PITFALLS.md` 或对应事实来源文档。

### 验证与收尾

- 代码改动后按 `.ch/docs/TESTING.md` 从最小相关范围开始验证，再按风险扩大范围。
- Java 项目需编译通过；Node 项目需执行相关 `build` / `tsc`；无代码改动时可不跑单测。
- 单测失败先分流为实现缺陷、测试断言过期、夹具问题、环境问题、历史失败或范围外失败，再修复或记录证据。
- 依赖真实 CLI、用户配置、日志、Webview 或 Extension Development Host 状态时，补充最小本机真实验证，记录命令、关键输出和结论。
- 非平凡任务收尾按 `.ch/docs/MEMORY.md` 判断是否需要更新热区记忆、runbook、skill 或 ontology。

### 仓库扩张

- 根级 `AGENTS.md` 不继续扩写百科；新规则优先放入 `.ch/docs/`、`.agents/skills/` 或业务目录附近的局部 `AGENTS.md`。
- 前端、后端、数据、平台、运维和测试目录出现稳定差异时，补就近入口文档，说明事实来源和验证命令。
<!-- END CODEX HARNESS RULES -->
