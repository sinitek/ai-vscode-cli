# CLI 可视化配置统一与精简

- 日期：2026-10-31
- 状态：completed
- 负责人：Codex / 人类 / 协作
- owner：Codex
- claimed_at：2026-10-31
- claim_ttl：本轮任务
- handoff_to：

## 背景

配置中心支持 Codex、Claude、OpenCode、Grok、DSH、KimiCode、ZCode 七类 CLI，但公共表单的列数、控件间距和字段呈现不一致。Codex Provider 当前只有详情编辑区，没有 ZCode 风格的左侧条目列表。

## 目标

统一所有 CLI 可视化配置的公共参数表单为桌面双栏、窄屏单栏，并统一字段标签、控件、说明和间距；为 Codex Provider 增加左侧列表、选择与删除入口；精简默认可视化表单，同时保留未展示的底层配置值。

## 范围

- 审查七类 CLI 可视化编辑器的公共参数和模型/Provider 编辑器。
- 抽取或复用共享字段栅格与字段样式，保持 VS Code 主题语义色。
- Codex Provider 左侧列表与右侧详情遵循 ZCode 的模型列表交互。
- 对确认属于高级/低频的字段从默认可视化区隐藏；保留 JSON/TOML 源码模式和未知字段往返行为。
- 更新 UI 回归测试、功能清单和必要的设计说明。

## 非目标

- 不改变任何 CLI 的运行参数、默认值、配置 schema 或模型执行行为。
- 不删除用户已有配置值，不改动聊天面板的模型管理。
- 不重做配置中心导航、主题或整体信息架构。

## 验收标准

- [x] 七类 CLI 的公共参数区使用同一双栏表单布局，窄屏自然收为单栏。
- [x] 各表单字段标签、控件宽度、帮助文案和垂直节奏一致。
- [x] Codex Provider 左侧列表支持新增、选择和带图标的删除，右侧编辑所选 Provider。
- [x] 精简字段不丢失已有配置，保存后隐藏字段和未知字段仍被保留。
- [x] 现有 CLI 配置编辑、ZCode 列表、保存和导入行为回归测试通过。

## 影响面

- 代码目录：`media/config/assets/`、`src/test/config/`。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`、`.ch/docs/exec-plans/`。
- 配置与脚本：不改变 CLI 配置 schema；可能新增配置页布局样式资源。

## 风险与缓解

- 风险：直接修改可视化字段可能导致已有配置值丢失。
- 缓解：仅隐藏控件，不改变 parser/serializer 状态和源码模式；为隐藏值往返添加回归测试。
- 风险：共享字段样式改动影响七类编辑器的提示、特殊控件或窄屏布局。
- 缓解：复用既有控件语义，按各 CLI 页面补充渲染断言并进行浏览器检查。
- 风险：当前工作区包含大量其他未提交改动。
- 缓解：仅编辑确认干净的配置 UI、相邻测试和本计划；不重置、整理或覆盖其他文件。

## 验证计划

- 最小相关验证：配置编辑器及静态渲染相关单测。
- 单元自测命令：`npm run build`；构建后运行涉及 Claude、Codex、OpenCode、Grok、DSH、KimiCode、ZCode 的配置页测试。
- 扩展验证：按 Chromium smoke skill 条件执行配置页可视化检查；运行 Impeccable detector；执行 Ontology validate（仅在本体内容变更时）。

## 测试与清单同步

- 单元测试新增/更新：覆盖公共双栏布局、Codex Provider 列表增删选、隐藏字段和未知字段保存。
- 单元自测结果：构建及全部 302 项配置测试通过。
- 失败处理记录：旧有自适应列宽、字段间距、OpenCode 主模型全宽等断言已按新双栏要求更新；新增 Codex 夹具的选择函数和 source 属性错误已修正；没有修改无关运行时实现来迎合测试。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `sinitek-cli-plugin-capabilities.md` 的 Codex 精简行为和 OpenCode 主模型半宽规则；共享样式契约记录于该配置中心章节，不另建重复设计文档。

## 任务列表

- [x] 完成精简策略澄清，采用隐藏但保留。
- [x] 审计七类 CLI 表单字段与样式。
- [x] 实现共享双栏与 Codex Provider 列表。
- [x] 补测试并同步功能文档。
- [x] 执行构建、单测与页面检查。

## 决策记录

- 2026-10-31：用户确认默认可视化中隐藏少用参数，但保留 JSON/TOML 配置值，避免保存造成数据丢失。
- 2026-10-31：工作区有大量未提交改动，仅在目标 UI/测试路径干净的前提下原位进行局部修改。

## 当前结论

已完成七类配置编辑器审计与统一实现：公共表单使用共享双栏栅格，窄屏收为单栏；Codex 公共配置移到 Provider 工作区上方，Provider 列表支持新增、选择和图标删除；Codex 可视化隐藏低频字段但保留 TOML 原值。官方 `@openai/codex` 0.166.0 及主分支 schema 的 `WireApi` 仅有 `responses`，下拉不添加其它协议。

## 验证结论

- `npm run build`：通过。
- `node --test dist/test/config/*.test.js`：302 项通过，0 项失败。
- `node --check media/config/assets/config-app-ui.js`：通过。
- `node .tmp/cli-config-visual-smoke.cjs`：通过 14 组检查（七类 CLI，1440px 与 620px），无页面错误、请求失败或布局溢出；Codex Provider 新增、取消删除、确认删除和 `wire_api` 候选已验证。
- `node /Users/fangjiawei/.codex/skills/impeccable/scripts/detect.mjs --json media/config/assets/config-app-ui.js media/config/assets/index-Dl7d6WMN.css`：空结果。
- `git diff --check -- media/config/assets/config-app-ui.js media/config/assets/index-Dl7d6WMN.css src/test/config`：通过。
- 未更新 ontology：本次只调整配置页表现层和已有配置保留行为，没有新增或改变业务概念、关系或权限边界。

## 官方协议核实

- 核实日期：2026-10-31。npm 官方包的 `latest` 为 `@openai/codex` 0.166.0，来源：`https://registry.npmjs.org/@openai/codex/latest`。
- 对应 OpenAI 官方发布 tag 的配置 schema：`https://raw.githubusercontent.com/openai/codex/rust-v0.166.0/codex-rs/core/config.schema.json`。
- 官方主分支配置 schema：`https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/config.schema.json`。
- 两份 schema 的 `definitions.WireApi.oneOf` 都只有 `enum: ["responses"]`；`ModelProviderInfo.properties.wire_api.default` 为 `responses`。不增加 `chat`、`chat_completions` 或 `messages` 等不受当前 Codex 支持的选项。已有旧值沿用既有兼容展示和无损保存机制，并在帮助中明确不代表支持。
- 官方手册 helper 及配置网站均返回 HTTP 403；因此以上述同属 OpenAI 官方的一手发布版和主分支 schema 为判断依据，没有把无法访问的网站描述为已读。

## 验证边界与清理

- Chromium 使用真实 `getConfigViewHtml` 和仓库静态资源，宿主通信由内存中的内置范例模拟。未读取、应用或更改个人 CLI 配置，未发送模型请求；这不是 VS Code Extension Development Host 或真实 CLI 端到端验收。
- 浏览器检查覆盖七类编辑器的 1440px 双栏与 620px 单栏、公共区无溢出、输入控件 32px 高度，以及 Codex 公共区上置、Provider 新增/取消删除/确认删除、协议候选和保存后的高级值保留；浏览器页面/控制台/请求错误均为零。
- 初次 smoke 的失败分为本机 Playwright 与 Chromium 缓存版本不一致，以及 Ant Design 中文按钮自动空格和虚拟选项定位问题；仅修正临时夹具后通过，没有为此改动产品交互。
- 浏览器结果与截图位于 `/tmp/sinitek-cli-config-visual-smoke/`；临时 `.tmp/cli-config-visual-smoke.cjs` 已删除，不新增项目依赖或测试服务器。
- 长期事实已同步功能文档；本轮不额外写入 ROLLING_SUMMARY、EVENT_MEMORY 或新增 ontology 规则，避免重复沉淀纯布局细节。
