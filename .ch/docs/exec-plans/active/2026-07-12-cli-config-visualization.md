# Codex、Claude、OpenCode CLI 配置可视化扩展

- 日期：2026-07-12
- 状态：completed
- 负责人：Codex / 主任务协作
- owner：Loop 主任务 `msg_1783863365764_c2291c1e371688`
- claimed_at：2026-07-12
- claim_ttl：当前 Loop 执行期
- handoff_to：Loop 主任务最终复核与归档

## 背景

配置中心当前已覆盖 Codex、Claude 和 OpenCode 的配置档案与卡片级保存；三种 CLI 的原生配置格式、保存边界和运行时含义不同。用户希望三组配置都能以可视化方式编辑，并在各自官方文档核验后补充稳定参数，把具有封闭且稳定取值域的文本输入升级为单选或多选控件。

本计划先记录实施前的后续路径与门禁，随后在本文件保留实际交付结论。仓库事实来源表明：Codex 主配置采用 TOML，Claude 和 OpenCode 的对应主配置采用 JSON；OpenCode 的模型/Provider 配置与全局 MCP 配置文件继续分离。所有新增字段、枚举与兼容性结论均以本计划中的官方 URL、访问日期和当前实现/测试证据为边界；没有捕获到的 CLI/doc 版本或官方默认值不作推断。

## 目标

1. 为 Codex、Claude、OpenCode 建立基于官方文档、版本和证据可追溯的可视化字段清单。
2. 在不丢失未知配置的前提下，实现原生源码与可视化编辑模式之间的可逆切换：Codex 使用 TOML 源码模式，Claude/OpenCode 使用 JSON 源码模式。
3. 将已核验且适合受控取值的字段升级为单选、多选、布尔、数值或结构化控件，并为未知/过期值保留安全回退。
4. 保持 VS Code 主题语义化样式、中英文文案、配置协议、保存错误反馈和最小自动化护栏一致。

## 范围

- Codex、Claude、OpenCode 三组配置卡片的字段核验、领域映射、可视化控件、源码/可视化切换与保存链路。
- 三种原生配置的解析、校验、定向合并、未知字段保留、无效源码保护和用户可见错误反馈。
- 适合改为 select / multi-select 的既有文本输入，以及已核验新增稳定字段的控件选择。
- 配置中心扩展宿主、Webview 协议、受版本控制的 Webview runtime asset、国际化和相关单元测试。
- 实施完成后同步更新能力规格、功能总表、运行时参考与本计划的验证记录。

## 非目标

- 不替代 Codex、Claude 或 OpenCode 的安装、鉴权、CLI 运行时或全部高级配置能力。
- 不把尚未由官方文档、版本和现状代码共同核验的字段、默认值、枚举或弃用状态暴露为正式 UI。
- 不将 OpenCode 模型/Provider 配置与全局 MCP 配置合并为同一张卡片或同一个文件。
- 不为视觉效果直接硬编码颜色，不引入新的前端构建链路，也不修改哈希 `index-*` 静态资产；当前受版本控制的 `config-app-ui.js` 仅按已核验行为和测试直接维护。
- 文档收尾阶段不再修改产品代码、测试、静态资源、兼容入口或 `dist`；已完成的实现、定向测试和事实来源同步见“完成记录”。

## 验收标准

- [x] 三套 CLI 均形成可审计的字段核验台账：官方原始 URL、访问日期、已知文档/CLI 版本或“未在证据中捕获”标记、配置文件与作用域、字段路径、类型、已核验允许值、兼容性、候选控件和纳入决定完整可查；未明确验证的默认值不写成事实。
- [x] 台账中每一个进入 UI 的字段均有“已核验”证据；未核验项保持待定，不出现在正式参数声明、枚举或默认值中。
- [x] Codex、Claude、OpenCode 都提供原生源码与可视化编辑入口；Codex 继续使用 TOML 而非伪装成 JSON，Claude/OpenCode 使用 JSON。
- [x] 可视化保存只定向更新已编辑字段，保留未知顶层和嵌套字段；无法解析、未知形状或不支持的值不被静默删除。
- [x] 合适的稳定受控值字段使用 select / multi-select；当前配置中存在未知、已弃用或未来值时仍可查看、提示并安全保存，不强制改写为猜测值。
- [x] 新增/改动的用户可见文案同时具备中文和英文；样式只使用项目现有的 VS Code 主题语义变量/样式约定。
- [x] 最小相关单元测试、TypeScript 构建和静态检查均通过，命令与结果已记录在“测试与清单同步”；真实 VS Code Webview 点击回归未在本批重复，作为非阻塞残余风险记录在“完成记录”。
- [x] 已同步功能清单与能力规格；运行时参考、设计/排障文档均经范围判断无需在本批授权内改写，原因已记录在“测试与清单同步”。

## 实施阶段：已完成

**阶段状态：** 官方文档与现状核对、共享 UI 集成、定向自动化验证和产品事实来源同步均已完成。下文台账中的“当前 UI / 保存状态”是实施前基线，`include` 是当时的实施授权；实际用户可见结果、验证证据和风险以本计划的“完成记录”为准，不能再把基线描述读作当前能力。

### 证据口径与实施门禁

- 访问日期均为 `2026-07-12`。首轮审计记录的是访问到的当前官方在线文档；审计未捕获可作为兼容基线的精确 CLI/doc 版本号，故本计划不臆造版本或默认值。实现、测试和产品文档只可引用下表明确列出的类型与值域。
- `inherit` / `跟随默认` 是 UI 的“不写入该字段”语义，不是对任一 CLI 官方默认值的断言。除非来源明确验证，否则台账不记录默认值。
- `未知值回退` 一律优先保存原始有效配置。若字段形状不是可视化表单可无损表达的标量、数组或对象，必须保留原生 TOML/JSON，阻止危险的可视化覆盖，或要求用户在源码模式显式迁移。
- 当前实施仅可改动受管字段。所有 `source` 深拷贝保留语义、非受管未知键、额外 `env`/权限键和无效源码保护均是回归门禁，而不是可选优化。

### 官方字段证据台账

以下矩阵把原始 URL、文件/作用域、实施前现状和实施决定放在同一行。`实施前 UI` 反映共享 UI 审计时的状态；“保留”不等于当时已经有可见控件。完成后的实际控件见“完成记录”。除明确标注 `include` 的项外，不得随实现便利扩展字段范围。

#### Codex

原始官方来源：<https://developers.openai.com/codex/config-reference/>（访问时跳转到 OpenAI Learn 的当前配置参考）和 <https://developers.openai.com/codex/config-file/environment-variables/>；访问日期：`2026-07-12`。官方用户级文件是 `~/.codex/config.toml`，但插件目前固定读写 `~/.codex`，因此本批只覆盖插件现有用户级路径，不声称覆盖项目级或 profile。

| 字段路径 | native file / scope | 官方原始 URL / 访问日期 | 类型与已核验允许值 | 实施前 UI / 保存状态 | 纳入控件 | 未知值回退与兼容风险 | 决定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `model_verbosity` | `~/.codex/config.toml`；用户级 | <https://developers.openai.com/codex/config-reference/>; `2026-07-12` | `string`：`low`、`medium`、`high`；仅在 GPT-5 + Responses 模式适用 | 已被现有 visual state/serializer 管理，但没有可见字段 | 固定 select：inherit / `low` / `medium` / `high` | 现有未知、旧值或不适用模型不能被清空；保留原值并提示兼容状态 | `include` |
| `developer_instructions` | 同上 | <https://developers.openai.com/codex/config-reference/>; `2026-07-12` | 自由 `string`；没有枚举 | 未作为视觉字段管理 | 多行文本域 | 引号、换行和空值必须 TOML 往返；不得与 `instructions` 或 `AGENTS.md` 混同 | `include` |
| 顶层 `web_search` | 同上 | <https://developers.openai.com/codex/config-reference/>; `2026-07-12` | `string`：`disabled`、`cached`、`indexed`、`live` | 当前是 bool 三态，保存其他字段时可能丢失 string mode | 固定 select：inherit / 四个 mode | 已有 bool 是 legacy 形状，未知 string 也必须原样保留，除非用户明确选择迁移值 | `include` |
| `[model_providers.<id>].wire_api` | 同上；用户自定义 Provider map | <https://developers.openai.com/codex/config-reference/>; `2026-07-12` | 可选 `string`；当前官方参考仅列出 `responses` | 自由文本 | 固定 select：inherit / `responses` | `chat` 或其他既有值不可静默删除；保留 raw 值，用户需显式迁移 | `include` |
| `approval_policy` | 同上 | <https://developers.openai.com/codex/config-reference/>; `2026-07-12` | 简单 `string`：`untrusted`、`on-request`、`never`；另支持 granular table；`on-failure` 已弃用 | 简单 select 目前提供 `on-failure`，复杂 table 会被空值覆盖 | 简单 string 固定 select；table 仅源码保留 | 不再产生 `on-failure`；遇到 table 锁定/保留源码，不能把复杂值归一为空 | `include`（兼容保护） |
| `model_reasoning_effort` | 同上 | <https://developers.openai.com/codex/config-reference/>; `2026-07-12` | `string`：`minimal`、`low`、`medium`、`high`、`xhigh`；模型支持子集不同 | 现有 select 还提供 `max` | 固定 select，仅提供已核验值 | `max` 或未来值保留 raw 值，不再由新 UI 产生 | `include`（兼容保护） |
| `[tools].web_search` | 同上 | <https://developers.openai.com/codex/config-reference/>; `2026-07-12` | legacy `boolean` 或扩展 object；object 的完整子字段不在本批建模 | bool 三态会覆盖 object | legacy bool 可保留；object 仅源码保留 | object 不能被 bool 或空值覆盖；仅做无损保护，不在本批表单化 | `include`（兼容保护） |
| `[features].web_search` | 同上 | <https://developers.openai.com/codex/config-reference/>; `2026-07-12` | 已弃用 `boolean` feature flag | 当前 bool 入口可能写入 | 不提供新视觉入口；原始 TOML 保留 | 不再产生该字段；既有值不得在保存其他字段时丢失 | `reject-new / include-compat` |

#### Claude

原始官方来源：<https://code.claude.com/docs/en/configuration>、<https://code.claude.com/docs/en/settings>、<https://code.claude.com/docs/en/model-config> 和 <https://code.claude.com/docs/en/env-vars>；访问日期：`2026-07-12`。本批仅处理用户级 `~/.claude/settings.json` 的插件档案 `content`；`~/.claude.json`/MCP、项目、项目本地和托管设置不混入本表单。

| 字段路径 | native file / scope | 官方原始 URL / 访问日期 | 类型与已核验允许值 | 实施前 UI / 保存状态 | 纳入控件 | 未知值回退与兼容风险 | 决定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `permissions.defaultMode` | `~/.claude/settings.json`；用户级 | <https://code.claude.com/docs/en/configuration>; `2026-07-12` | `string`：`default`、`acceptEdits`、`plan`、`auto`、`dontAsk`、`bypassPermissions`；`manual` 是 `default` 别名 | 自由文本，未校验完整枚举 | 固定 select：inherit / 六个正式值；`bypassPermissions` 明确风险帮助 | `manual`、未知值必须保留 raw 值；`auto` 仅用户设置支持，不能无提示覆盖 | `include` |
| `effortLevel` | 同上 | <https://code.claude.com/docs/en/configuration> + <https://code.claude.com/docs/en/model-config>; `2026-07-12` | 持久化 `string`：`low`、`medium`、`high`、`xhigh`；`max` 是会话/环境变量语义，不是普通持久化值 | 已有 select，但包含 `max` | 固定 select：inherit / 四个持久化值 | 不再产生 `max`；遗留 `max` 与未知值保留 raw 值，不在保存其他字段时删除 | `include`（修正） |
| `autoCompactEnabled` | 同上 | <https://code.claude.com/docs/en/configuration>; `2026-07-12` | `boolean`：`true` / `false` | 未暴露；作为 source 中未知键保留 | 三态 select：inherit / true / false | 非 bool 形状走源码回退；旧客户端可能仍把该类偏好放在 global config | `include` |
| `autoMemoryEnabled` | 同上 | <https://code.claude.com/docs/en/configuration>; `2026-07-12` | `boolean`：`true` / `false` | 未暴露；保留 | 三态 select：inherit / true / false | 环境变量可改变最终运行行为；UI 配置值不能承诺实际生效结果 | `include` |
| `fileCheckpointingEnabled` | 同上 | <https://code.claude.com/docs/en/configuration>; `2026-07-12` | `boolean`：`true` / `false` | 未暴露；保留 | 三态 select：inherit / true / false | 需说明文件回滚/检查点影响；非 bool 走源码回退 | `include` |
| `editorMode` | 同上 | <https://code.claude.com/docs/en/configuration>; `2026-07-12` | `string`：`normal`、`vim` | 未暴露；保留 | 固定 select：inherit / `normal` / `vim` | 未知旧值保留；旧版作用域差异不应被静默迁移 | `include` |
| `viewMode` | 同上 | <https://code.claude.com/docs/en/configuration>; `2026-07-12` | `string`：`default`、`verbose`、`focus` | 未暴露；保留 | 固定 select：inherit / 三个值 | 仅影响 CLI/TUI 展示；未知值保留 | `include` |
| `tui` | 同上 | <https://code.claude.com/docs/en/configuration>; `2026-07-12` | `string`：`default`、`fullscreen` | 未暴露；保留 | 固定 select：inherit / 两个值 | 仅影响 CLI/TUI 展示；未知值保留 | `include` |
| `verbose` | 同上 | <https://code.claude.com/docs/en/configuration>; `2026-07-12` | `boolean`：`true` / `false` | 未暴露；保留 | 三态 select：inherit / true / false | 仅影响 CLI 详细输出；非 bool 走源码回退 | `include` |

#### OpenCode

原始官方来源：<https://dev.opencode.ai/docs/config/>、<https://opencode.ai/config.json>、<https://dev.opencode.ai/docs/models/>、<https://dev.opencode.ai/docs/permissions/> 和 <https://dev.opencode.ai/docs/cli/>；访问日期：`2026-07-12`。官方配置支持 global/project/custom 多层和 JSON/JSONC；插件档案 `~/.opencode/config.json` 当前会生成 `OPENCODE_CONFIG` runtime overlay，**不是**官方 global MCP 文件 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json`。本批仅编辑同一份插件模型配置内容，继续与 global MCP 分离。

| 字段路径 | native file / scope | 官方原始 URL / 访问日期 | 类型与已核验允许值 | 实施前 UI / 保存状态 | 纳入控件 | 未知值回退与兼容风险 | 决定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `share` | 插件 `~/.opencode/config.json` profile，经 `OPENCODE_CONFIG` runtime overlay；官方同名配置内容 | <https://dev.opencode.ai/docs/config/> + <https://opencode.ai/config.json>; `2026-07-12` | `string`：`manual`、`auto`、`disabled` | 未暴露；source clone 保留 | 固定 select：inherit / 三个值 | 未知未来值保留 raw；inherit 必须删除字段而非写标签 | `include` |
| `autoupdate` | 同上 | <https://dev.opencode.ai/docs/config/> + <https://opencode.ai/config.json>; `2026-07-12` | `boolean` 或 `string` `notify`：`true`、`false`、`notify` | 未暴露；保留 | 固定 select：inherit / enabled / `notify` / disabled，序列化为真实 bool/string | `false` 与缺失不等价；未知联合值保留 raw | `include` |
| `logLevel` | 同上 | <https://opencode.ai/config.json> + <https://dev.opencode.ai/docs/cli/>; `2026-07-12` | `string`：`DEBUG`、`INFO`、`WARN`、`ERROR` | 未暴露；保留 | 固定 select：inherit / 四个值 | 未来/未知值保留 raw，不被 select 清空 | `include` |
| `snapshot` | 同上 | <https://dev.opencode.ai/docs/config/> + <https://opencode.ai/config.json>; `2026-07-12` | `boolean`：`true` / `false` | 未暴露；保留 | 三态 select：inherit / true / false | `false` 与缺失不等价；非 bool 走 JSON 源码回退 | `include` |
| 顶层 `model` | 同上 | <https://dev.opencode.ai/docs/config/> + <https://dev.opencode.ai/docs/models/>; `2026-07-12` | 自由 `string`，通常 `provider/model`；内置/其他配置层的引用可不在当前 `provider` 中 | 当前为模型卡 checkbox，只能选择本地声明项 | 可编辑、可搜索的单值 combobox；建议只来自当前 `provider.*.models`、现有 `model` / `small_model` | 未声明、内置、旧或未知 ref 必须保留且可见；不能从官方示例造候选 | `include` |
| 顶层 `small_model` | 同上 | <https://dev.opencode.ai/docs/config/> + <https://dev.opencode.ai/docs/models/>; `2026-07-12` | 同 `model` | 同上 | 与主模型相同的 editable combobox；二者可指向同一 ref | 同 `model`；禁止互斥校验导致同一 ref 被删除 | `include` |
| `provider.<id>.npm` | 同上；动态 Provider map | <https://dev.opencode.ai/docs/config/> + <https://opencode.ai/config.json> + <https://dev.opencode.ai/docs/models/>; `2026-07-12` | 自由 `string` npm package 名；没有官方完整 adapter 枚举 | 固定建议的可搜索单选 | editable combobox：保留现有建议，但允许任意输入 | 既有/新建未知包名必须往返；不能把四个建议当作官方全量 enum | `include` |
| `provider.<id>.models.<id>.options.reasoningEffort` 与 `variants.*.reasoningEffort` | 同上；Provider/model-specific 动态对象 | <https://opencode.ai/config.json> + <https://dev.opencode.ai/docs/models/>; `2026-07-12` | 自由、Provider/model-specific `string` 集合；没有全局固定 effort enum | 固定五项多选会重建 default/simple variants | 动态、可编辑多值列表：建议来自当前 default 与 variant key，允许自定义值 | 自定义、`none`、`minimal`、`max` 或其他 Provider-specific variant 不能删除/改写；复杂 variant 要原样保留 | `include`（兼容保护） |

### 本批延后、拒绝和保留源码范围

| 范围 | 决定 | 原因与当前安全行为 | 重新进入实施的前置条件 |
| --- | --- | --- | --- |
| `CODEX_HOME`、Codex 项目级 `.codex/config.toml` 与官方 profile | `defer` | 插件路径目前固定为 `~/.codex`；路径/作用域修复会改变读写目标，不能附带在字段 UI 改动中 | 单独设计路径解析、临时目录运行验证和配置服务回归 |
| `CLAUDE_CONFIG_DIR`、Claude 项目/本地/托管/global config 作用域 | `defer` | 当前服务固定用户级目录；环境变量是路径语义，不是 `settings.json` 字段 | 单独路径解析、版本兼容策略和 `configService` 测试 |
| OpenCode JSONC | `defer` | 官方允许 JSONC，当前 visual parser、JSON 模式校验和运行前模型解析均为严格 JSON；局部修复会造成保存/运行时不一致 | 全链路 JSONC 解析/序列化与 runtime overlay 实测 |
| OpenCode runtime discovery、官方内置 provider/model/agent 列举 | `defer` | 当前协议无 discovery action；官网示例不是用户实际安装/配置数据 | 可失败降级的运行时 discovery 设计、错误与缓存策略、无静态样例兜底 |
| OpenCode 内置或未声明 `model` / `small_model` 的运行前预检放宽 | `defer` | 官方允许的引用与当前 `validateState()` / 模型解析严格要求存在于 `provider` 不一致 | 目标 CLI 版本实测及独立 runtime validation 决策；本批只保证视觉层不丢失引用 |
| Codex granular `approval_policy`、`[tools].web_search` object、Provider headers/retry/timeouts、sandbox/feature/MCP 等复杂 TOML | `defer`（结构化编辑）；`include`（无损保护） | 嵌套规则、路径、凭据或安全语义无法由本批标量表单完整表达 | 专用 schema、权限 UX、无损 round-trip 测试 |
| Claude `hooks`、`attribution`、sandbox、`apiKeyHelper`、复杂 permissions、MCP、agents/output styles 和开放模型/语言列表 | `defer` | 命令、凭据、组织策略或开放文本/对象边界不能压缩成静态控件 | 独立安全设计；复杂对象保留在 JSON，MCP 继续走现有专用流程 |
| OpenCode `compaction`、`attachment.image`、`permission`、`mcp`、`agent`、command/LSP/formatter/plugin/server/experimental | `defer` | 数值范围、对象形状、权限和运行时语义尚不能无损可视化；MCP 还有独立全局文件边界 | 每类字段单独核验 schema、权限影响和原生配置往返 |
| Codex `[features].web_search`、Claude `includeCoAuthoredBy`、OpenCode `tools` | `reject-new` | 官方已弃用或当前文档未确认；不能继续作为新 UI 能力 | 仅保留存量原文；未来只有官方迁移路径明确时才评估 |

### 已完成现状核对结论

- 已吸收四份首轮审计：三组编辑器共用 `media/config/assets/config-app-ui.js`；宿主通用 `save` / `apply` 协议足以承载本批配置文本，不需要扩展消息 action。
- `config-app-ui.js` 是受版本控制的当前 Webview runtime asset；仓库未发现可再生的前端源码或生成脚本，`npm run build` 只会清理 `dist/` 后执行 TypeScript 编译。实现子任务可在授权范围内直接维护该 canonical asset 和对应测试，但不得猜测或只改哈希 `index-*` 文件。
- 三组均已有源码/可视化双模式、原始 `source` 定向合并和解析失败保护。现有保护对 Codex 复杂受管 TOML、OpenCode JSONC/未声明内置模型和部分受管非预期类型仍不完整，因此上表明确把这些情况列为本批回归门禁或延期项。

## 完成记录（2026-07-13）

### 已实施字段与控件

- **Codex：** `~/.codex/config.toml` 保持 TOML 可视化/源码双模式。视觉编辑器新增或收紧 `model_verbosity`、顶层 `web_search`、`approval_policy`、`model_reasoning_effort` 和 Provider `wire_api` 单选，新增 `developer_instructions` 多行文本，并保留现有布尔字段。新写入的 `wire_api` 只建议 `responses`，但旧 `chat`/未知值仍保留；granular `approval_policy` table、`[tools].web_search` object、弃用 `[features].web_search` 与其他复杂 TOML 不由标量表单重写。
- **Claude：** `~/.claude/settings.json` 保持 JSON 可视化/源码双模式。`permissions.defaultMode` 升级为带 `bypassPermissions` 风险提示的单选；`autoCompactEnabled`、`autoMemoryEnabled`、`fileCheckpointingEnabled`、`verbose` 使用继承/true/false 三态控件；`editorMode`、`viewMode`、`tui` 使用稳定单选。模型、语言、开放权限规则和复杂 `hooks`/`attribution`/MCP 等仍按自由文本或 JSON 源码边界处理，未知键、额外 `env` 和复杂策略继续定向保留。
- **OpenCode：** `~/.opencode/config.json` 保持 JSON 可视化/源码双模式，并继续与官方全局 MCP 文件 `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` 分离。顶层 `share`、`autoupdate`、`logLevel`、`snapshot` 使用继承语义的单选/三态控件；`model`、`small_model` 与 Provider `npm` 升级为可编辑、可搜索组合框；模型 reasoning effort 升级为可输入 tags 多值控件。建议仅来自当前配置，任意 npm、未声明/内置模型引用、两个角色使用同一引用、未知值和 provider-specific/复杂 variants 均不会因无关保存而丢失。

### 思考力度与兼容边界

- 面板和配置中心统一显示 raw value，不把 `low`、`xhigh`、`max` 或 `ultra` 翻译成中文别名。所有同时提供固定 `max` 和 `ultra` 的用户可见列表按 `... xhigh, max, ultra` 排列，`ultra` 为末位。
- `ultra` 是本次用户要求的产品级扩展，不宣称为 Codex、Claude、OpenCode 三家共同确认的官方固定枚举。Codex/Claude 会保留并传递该 raw value，实际兼容性取决于用户安装的 CLI 和模型；其配置编辑器的新建固定候选止于 `ultra`，不会重新把 `max` 作为新值提供。加载存量 `max` 时，仅将兼容选项插入 `ultra` 前；未知值继续保留。
- OpenCode 的面板思考力度以精确 `provider/model` 的 metadata 或当前配置 variants 为准，动态 payload 的 `option.value` 与原始顺序直接呈现，不按固定序列排序、过滤或伪造。配置编辑器仅添加无损的 `ultra` 建议，仍允许 provider-specific/custom effort，且没有全局固定 reasoning effort enum。

### 已验证证据

- 共享 UI 集成已执行 `npm run build`、`node --test dist/test/codexConfigVisualEditor.test.js dist/test/claudeConfigVisualEditor.test.js dist/test/opencodeconfigvisualeditor.test.js`（`31/31` 通过）和 `node --check media/config/assets/config-app-ui.js`。
- raw value 与 `ultra` 接入已执行 `npm run build`、八个定向 `dist/test` 文件（`81/81` 通过）、静态资源语法检查、`package.json`/两份 NLS JSON 解析和授权范围 `git diff --check`。
- 最终排序修复已执行 `npm run build`、六个定向 `dist/test` 文件（`70/70` 通过）、静态资源语法检查、三份 JSON 解析和授权范围 `git diff --check`。测试明确覆盖固定列表 `max` 在 `ultra` 前、Codex/Claude legacy `max` 插入策略，以及 OpenCode 自定义动态 variants 的原序与 raw value。

### 明确延期项与遗留风险

- 延期范围保持不变：`CODEX_HOME`/项目级 Codex profile、`CLAUDE_CONFIG_DIR` 与 Claude 其他作用域、OpenCode JSONC、runtime discovery、内置/未声明模型的运行前预检放宽，以及复杂 TOML/JSON 的权限、MCP、agent、compaction、attachment 等结构化编辑。
- 本轮没有在真实安装的三家 CLI 版本上逐个运行 `ultra`，也没有重新执行真实 VS Code Webview 点击回归；自动化已覆盖状态、序列化、运行时传递和动态选项边界。外部 CLI/model 对 `ultra` 的接受程度及原生 `datalist` 的主题/窄屏交互仍是非阻塞兼容风险。
- OpenCode 官方 JSONC 与内置模型引用的现有解析/预检差异未被本批改变；视觉层的无损保留不等于运行时预检已放宽。

## 影响面

- 代码目录：
  - `src/config/`：配置档案、原生格式解析/保存、定向合并和外部配置文件边界。
  - `src/webview/configPanel.ts`、`src/webview/configView.ts`、`src/webview/configProtocol.ts`：配置中心消息协议、资源装载和错误回传。
  - `media/config/assets/config-app-ui.js`：受版本控制的 canonical Webview runtime asset，承载三组表单、源码/可视化状态、主题语义样式和字段文案；三个平台不可并发分拆写入此物理文件。
  - `src/webview/configView.ts`：Webview 装载和 `CONFIG_TRANSLATIONS_EN` / pattern 英文映射；新增动态文本也须在这里可翻译。
  - `src/test/`：Codex、Claude、OpenCode 配置可视化、共享控件、配置服务和协议回归测试。
- 文档目录：
  - `.ch/docs/product-specs/FEATURE_INVENTORY.md`
  - `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
  - `.ch/docs/references/cli-runtime-reference.md`
  - `.ch/docs/design-docs/vscode-cli-extension-runtime.md`（仅当实际边界、协议或构建方式改变时）
  - `.ch/docs/runbooks/PITFALLS.md`（发现高复发解析、构建或兼容陷阱时）
- 配置与脚本：
  - 各 CLI 的用户级原生配置文件和 VS Code 扩展配置档案读写行为。
  - `package.json` 中现有构建命令；若前端构建缺少可重复入口，单独规划最小脚本改动并先获主任务确认。

## 风险与缓解

- 风险：未核验字段或枚举被当作官方事实，导致错误 UI、无效保存或跨版本不兼容。
  - 缓解：逐字段台账、版本/访问日期留档、未核验项不实现；每批实现前复核官方资料与本机 CLI `--help`/版本。
- 风险：可视化保存丢失未知字段、复杂嵌套对象、未来枚举值、额外环境变量或用户手写配置。
  - 缓解：以原始有效文档为基线定向合并；未知值展示为兼容回退状态；无法无损理解时保留源码模式并阻止危险保存。
- 风险：Codex TOML、Claude JSON、OpenCode JSON 的语法/作用域差异被过度抽象。
  - 缓解：共享控件只共享显示和验证抽象，解析器、序列化器、文件边界和错误信息按 CLI 适配；Codex 不走 JSON 解析。
- 风险：OpenCode 模型/Provider 配置与全局 MCP 文件混淆，或把一次性 runtime overlay 写回用户配置。
  - 缓解：台账和保存协议都标注 native file + scope；测试覆盖跨文件隔离与运行时 overlay 不回写。
- 风险：`config-app-ui.js` 没有已发现的再生源码/构建链路，直接维护时容易让三平台共享逻辑或静态资产边界发生回归。
  - 缓解：只由一个集成者修改该 canonical runtime asset；不改哈希 `index-*` 资产；以三个视觉编辑器测试、`node --check`、主题/英文映射检查和单一执行者的 build 作为交付门禁。
- 风险：文本改受控控件后，用户已有未知/旧值被自动替换。
  - 缓解：控件保留当前未知值的可见 fallback，直到用户主动选择已核验值；保存不做隐式迁移。
- 风险：配置中包含令牌、API key 或企业策略，错误日志和测试夹具泄露敏感值。
  - 缓解：沿用现有脱敏策略；测试使用占位值；报告、截图和错误详情不得记录真实秘密。
- 风险：新增 UI 文案或样式未覆盖语言/主题，造成英文、中文或高对比主题退化。
  - 缓解：把中英文键、主题语义变量和窄宽度布局作为每一批的验收项。

## 验证计划

### 分批实施与验证顺序

1. **官方文档与现状核对：已完成。** 本计划的字段矩阵、来源、作用域和 include/defer/reject 决定是实施输入；未记录的字段没有随实现便利扩展。
2. **三组共享 UI 集成：已完成。** 唯一集成子任务在同一 `config-app-ui.js` 中完成本批 Codex、Claude、OpenCode 字段、英文映射与三份视觉编辑器测试；实际控件和保护见“完成记录”。
3. **单一自动化验证：已完成。** 构建、静态检查、视觉编辑器回归、raw value/`ultra` 运行时回归和最终排序回归均已有通过证据。真实 VS Code 点击回归未在本批重复，作为非阻塞风险保留，不倒灌为未验证的产品事实。
4. **产品事实来源同步：已完成。** 已同步功能清单与能力规格；官方 URL、访问日期、延期边界和未捕获默认值仍在本计划台账中维护。未在本批授权范围内改动的运行时参考/设计文档不因本次文档收尾而臆造新契约。

### 本批最小自动化门禁

实现者必须按表单语义补齐或更新三份视觉编辑器测试，且至少覆盖以下断言：

- **Codex：** `model_verbosity`、`developer_instructions`、顶层 string `web_search` 和 `wire_api` 的 parse → state → serialize；旧 bool/`chat`/未知值保留；granular `approval_policy` table、`[tools].web_search` object 和弃用 feature 不能在保存其他字段时丢失；新 UI 不再产生 `on-failure`、`max` 或 `[features].web_search`。
- **Claude：** `permissions.defaultMode` 的六个新写入值、`manual`/未知值回退、`bypassPermissions` 风险帮助；`effortLevel` 只新写持久化值且遗留 `max` 保留；七个新增标量的设置/清除/未知字段保留。
- **OpenCode：** `share`、`autoupdate`、`logLevel`、`snapshot` 的 inherit/set/clear；未声明或内置 `model` / `small_model` ref 保留且两个角色可相同；任意 npm 包名和自定义 effort/variant 往返；不得把官方样例转化为硬编码候选。
- **共同约束：** 保留每组原有无效 TOML/JSON 防覆盖语义、`source` 中未知顶层/嵌套键、Claude 额外 `env`/permissions、OpenCode `$schema`/`permission`/`mcp`；不新增硬编码颜色。

### 英文映射与手动检查

- 每个新增或改名的中文 label、option、help、warning、placeholder、`title` 和 `aria-label` 必须在 `src/webview/configView.ts` 的 `CONFIG_TRANSLATIONS_EN` 或适用 pattern 中有英文映射；动态未知值提示同样不可只留中文。
- 使用中文和英文界面检查表单、help、错误和未知值回退；使用默认主题和至少一种深色或高对比主题检查语义 token、焦点、禁用态与窄宽度布局。
- 在不含真实密钥的临时配置副本验证：有效 TOML/JSON、无效源码、复杂未知对象、重复保存、模式切换、保存失败和激活档案 save → apply 顺序。OpenCode 还要确认插件 profile/runtime overlay 不会写入 global MCP 文件。

### 正式检验命令

`npm run build` 会先清理共享 `dist/`，因此已由共享 UI 集成与随后单一排序修复执行者串行运行。以下命令保留为本批最初的最小门禁；真实执行结果见“完成记录”和“测试与清单同步”：

```bash
npm run build
node --test \
  dist/test/codexConfigVisualEditor.test.js \
  dist/test/claudeConfigVisualEditor.test.js \
  dist/test/opencodeconfigvisualeditor.test.js
node --check media/config/assets/config-app-ui.js
```

若变更超出本批 UI 资产，才按实际影响补充 `configService`、OpenCode 模型/配置示例或 MCP 测试；不能用全量 `dist/test/*.test.js` 替代上述三组针对性回归。

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/codexConfigVisualEditor.test.ts`、`src/test/claudeConfigVisualEditor.test.ts`、`src/test/opencodeconfigvisualeditor.test.ts`，覆盖解析、合并、未知字段保留、源码切换和受控控件语义；第 3 轮额外更新 panel、schema、runtime 与排序测试，覆盖 raw value、`ultra`、legacy `max` 和 OpenCode 动态顺序。
- 单元自测结果：共享 UI 集成已通过 `npm run build`、三份视觉编辑器测试（`31/31`）和 `node --check media/config/assets/config-app-ui.js`；raw value/`ultra` 批次通过八份定向 `dist/test`（`81/81`）；最终排序批次通过六份定向 `dist/test`（`70/70`）。三批均记录了相应静态资源/JSON/diff 检查的通过结果，未出现需作为范围外基线失败处理的项。
- 失败处理记录：若出现历史/范围外失败，记录失败命令、基线证据、影响和不在本计划中修复的理由；不得为通过测试改动无关逻辑。
- 功能清单：已在 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 中同步三组编辑器字段、源码模式边界、raw value/`ultra` 规则与定向验证证据。
- 相关文档同步：已更新 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。本批没有新增配置中心协议、构建链路或可复发的实现坑，且授权范围不包含运行时参考、设计文档和排障手册，故未修改它们。

## 任务列表

- [x] 创建本执行计划并明确当前阶段、边界、风险和验证记录位置。
- [x] 收集 Codex 官方配置资料并补全 Codex 字段台账。
- [x] 收集 Claude 官方配置资料并补全 Claude 字段台账。
- [x] 收集 OpenCode 官方配置资料并补全 OpenCode 字段台账。
- [x] 读取共享配置 UI 审计结果，确认真实源文件、资产边界、协议和测试入口。
- [x] 对每条候选字段完成 include / defer / reject 决策，并锁定固定 select、editable combobox、动态多值列表或源码保留方案。
- [x] 共享 UI 集成子任务：按本批台账实施三组可视化编辑器、英文映射与对应回归。
- [x] 执行最小相关构建、定向测试、静态检查和格式/JSON 校验，并记录结果；真实 VS Code 点击回归作为残余风险记录。
- [x] 同步功能清单和能力规格；运行时参考、设计/排障文档无需因本批授权范围内的文档收尾额外改写。
- [x] 将实施计划标记为完成并交接给主任务最终复核；文件按本轮授权保留在 `active/`，归档由主任务统一执行。

## 决策记录

- 2026-07-12：首轮官方资料和现状代码核对已完成；每项字段只按台账中的官方原始 URL、访问日期、类型和值域进入本批。审计没有捕获精确 CLI/doc 版本或官方默认值时，计划明确记录为未断言，不能补写猜测值。
- 2026-07-12：原生格式优先于统一表面形式。Codex 保持 TOML 源码模式，Claude/OpenCode 保持 JSON 源码模式；共享的是安全编辑体验与控件约束，不是强行统一文件格式。
- 2026-07-12：未知配置和未知枚举是兼容性数据，不是非法垃圾；可视化编辑必须定向合并并提供安全回退，不能静默删除。
- 2026-07-12：`config-app-ui.js` 是当前受版本控制的 canonical runtime asset，未发现再生源码/前端构建入口；由一个集成者直接维护、配套测试并执行单一 build，不能并行拆分三平台 UI 写入。
- 2026-07-12：本批 `include` 是实施授权而非已实现标记。复杂配置只纳入无损保护，`CODEX_HOME`、`CLAUDE_CONFIG_DIR`、OpenCode JSONC/discovery/内置模型预检和复杂 compaction/attachment/permission/MCP 保持延期。
- 2026-07-13：共享 UI、raw value、`ultra` 和最终显示顺序均已交付并通过定向验证。`ultra` 是用户要求的产品级值，不能回写为三家 CLI 共同的官方固定枚举；固定列表只在同一列表同时出现 `max`/`ultra` 时保证 `max` 紧邻在 `ultra` 前，OpenCode 精确模型的动态 variants 保持 payload 原序。

## 当前结论

本计划的实施目标已完成：三组 CLI 都有与原生 TOML/JSON 源码模式并存的可视化编辑器，稳定字段已采用合适的单选、三态、可编辑组合框、多值 tags 或文本控件，未知/复杂配置仍受定向合并与源码回退保护。官方 URL、`2026-07-12` 访问日期和 defer 边界继续保留在台账；`ultra` 的产品扩展、legacy `max` 兼容和 OpenCode 动态 variant 不重排已在完成记录中明确。主任务可据此进行最终独立审计并在整个 Loop 任务完成后统一归档本计划。
