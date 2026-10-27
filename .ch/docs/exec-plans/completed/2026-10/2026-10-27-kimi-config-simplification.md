# Kimi 配置显示与字段精简

- 日期：2026-10-27
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-27
- claim_ttl：本次任务
- handoff_to：

## 背景

用户要求插件中的 Kimi Code 统一显示为 kimi，范例去掉 `subcoco/` 前缀，并解释和展示 API Key 配置。默认配置与可视化表单需要只呈现主要及官方必要字段。

## 目标

- 用户界面中的 CLI 名称统一显示为 `kimi`，内部 id 和已有路由保持 `kimi-code`。
- 默认配置和一键导入范例使用无 `subcoco/` 前缀的模型别名，直接展示 API Key 或环境变量凭据配置。
- 可视化编辑器只保留默认模型、免审批、模型与 provider 必要字段；已有高级 TOML 字段继续保留。

## 范围

- `src/config/kimiCodeConfig.ts`、配置中心 Kimi 编辑器、CLI 显示标签。
- Kimi 相关回归测试、用户指南、功能清单、官方参考、runbook 和 ontology。

## 非目标

- 不修改内部 CLI id、配置存储 key、ACP 协议或已有配置档案结构。
- 不增加 Codex 风格的第二个鉴权文件，不注入或读取真实密钥。
- 不重设计配置中心的布局、主题、组件或其它 CLI。

## 验收标准

- [x] Tab、CLI 下拉、配置中心和 Skills 目标显示 `kimi`，内部值仍为 `kimi-code`。
- [x] 默认配置与范例不含 `subcoco/`，包含模型、API Key、URL、最大上下文及必要字段。
- [x] 文档明确凭据只配置在 `~/.kimi-code/config.toml`，无需第二个文件。
- [x] 可视化不再展示思考、Loop、显示名、能力声明等高级字段，往返保存保留已有高级字段。
- [x] 构建、相关测试、真实 `kimi doctor config` 和文档/ontology 校验通过。

## 影响面

- 代码目录：`src/config`、`src/cli`、`src/webview`、`media/config/assets`。
- 文档目录：`docs`、`.ch/docs/product-specs`、`.ch/docs/references`、`.ch/docs/runbooks`、`.ch/docs/ontology`。
- 配置与脚本：不新增依赖或脚本。

## 风险与缓解

- 风险：修改默认模型别名可能影响已有选择；精简可视化可能删除未展示字段。
- 缓解：已有档案内容不迁移；新增默认只作用于新档案；沿用 source 保留式序列化并添加回归断言；隔离 `KIMI_CODE_HOME` 验证官方 CLI。

## 验证计划

- 最小相关验证：`npm run build` 后运行 Kimi 配置、模型选择及 Webview 相关测试。
- 单元自测命令：`node --test dist/test/config/kimiCodeConfig.test.js dist/test/config/kimiCodeConfigPage.test.js ...`。
- 扩展验证：以隔离的 `KIMI_CODE_HOME` 运行 `kimi doctor config`，不触碰真实配置；不做真实 GUI 点击验收时明确记录。

## 测试与清单同步

- 单元测试新增/更新：默认配置、范例、可视化字段、UI 标签与高级字段保留测试。
- 单元自测结果：本轮 Kimi 配置、保存策略、模型选择及 ACP 相关测试 81/81；扩展 Webview 回归 125/127。
- 失败处理记录：首轮 1 个 TOML 数组格式断言过严，已改为语义断言。扩展回归 2 个 Grok 用例分别报 `getLoopRoleThinkingOptionsForCli is not defined` 与角色显示值 `none`，本次未改这些 Webview 文件；单独 `configService` 的既有 DSH 用例报环境变量断言失败，本次只修改 Kimi 写路径，均不扩大范围修复。
- 功能清单：更新 Kimi 行的配置契约与证据。
- 相关文档同步：Kimi 用户指南、官方参考、runbook、运行时参考及 ontology。

## 任务列表

- [x] 核对官方配置契约与现有实现
- [x] 调整显示名称、默认配置、范例和可视化
- [x] 更新测试、文档和 ontology
- [x] 构建并运行最小真实验证

## 决策记录

- 2026-10-27：Kimi 官方 CLI 凭据来自 `config.toml` 的 provider 字段，不新增第二个鉴权文件。
- 2026-10-27：显示名改为 `kimi`，内部 `kimi-code` 保持稳定；新默认别名为 `kimi-k3.1-pro`。
- 2026-10-27：默认与范例不写入 `[thinking]`、默认思考档及 `loop_control`；思考能力声明和五档支持列表属于运行必需字段，由默认配置、范例及统一保存链路补齐。

## 当前结论

`npm run build`、专项与 Webview 回归、whitespace、`git diff --check`、ontology 均通过。隔离 `KIMI_CODE_HOME` 下以精简默认配置运行 `kimi doctor config`，官方 CLI 返回 `OK config.toml` 与 `All checked config files are valid`。未修改真实用户配置，未做 VS Code 图形界面点击验收。

## 2026-10-27 思考声明回归修复

- 根因：精简默认配置时移除了 `capabilities` / `support_efforts`，但界面仍可下发 `high`，导致 ACP 报 `available: (none)`。
- 修复契约：所有 Kimi TOML 保存统一经过 `commitKimiCodeText`；每个模型缺 `thinking` 能力时补上，缺 `support_efforts` 时补五档。已有能力、显式档位限制和其它字段不覆盖，可视化仍不展示高级字段。
- 默认配置与范例重新包含 `capabilities = ["thinking"]` 和完整 `support_efforts`，不增加 `[thinking]`、`default_effort` 或 `loop_control`。
- 验收：`npm run build` 通过；缺字段、部分字段、显式空列表、幂等和磁盘写入回归通过；相关测试 81/81；`validate:whitespace`、`git diff --check`、ontology 及 9 个 ontology 单测通过。
- 真实验证：以隔离临时 `KIMI_CODE_HOME` 和占位环境变量凭据保存缺声明配置，`kimi doctor config` 返回 `OK config.toml` / `All checked config files are valid`；官方 `kimi acp` 启动成功，`thinking = "high"`，广告 `off / low / medium / high / xhigh / max`。未发送 prompt，未消耗模型额度，临时目录已删除。
- 保存成功后的 TOML 草稿和可视化状态使用同一份补齐内容，用户不需要重新打开档案才能看到自动字段。
