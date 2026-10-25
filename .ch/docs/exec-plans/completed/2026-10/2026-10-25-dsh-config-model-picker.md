# DSH 配置页模型编辑与对话模型切换

- 日期：2026-10-25
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

DSH profile 配置页当前成功载入后切到可视化模式，模型以表单行堆叠而非双栏列表/详情展示；聊天面板的通用模型选择器不包含 DSH，导致 profile 中有序配置的多个模型不能由用户选择。DSH ACP 执行链已有配置模型校验及 `session/set_config_option` 能力，应复用此链路而非增加并行执行实现。

## 目标

DSH 配置页首次打开及切换配置时默认展示 JSON；保存时规范化补齐固定 `apiKeyEnv`，可视化模式不显示该字段。可视化编辑器采用现有 Grok 模型工作区布局，左侧管理有序模型列表，右侧编辑选中模型和 profile 连接信息，并用下拉框选择 `acpModel`。对话模型选择器显示 profile 配置的模型，切换会持久化并在下一轮 DSH ACP 请求前由既有 `setModel` 确认生效。

## 范围

- DSH 配置编辑器的默认模式、保存规范化和可视化双栏模型列表/详情。
- DSH profile 模型候选到聊天选择器、选中状态、提示词请求和 ACP model wire 的端到端衔接。
- 相关配置页、Webview、模型选择与执行回归测试，产品清单及 DSH Ontology 规则同步。

## 非目标

- 不改变 DSH provider、模型 wire 格式、ACP 配置选项协议、默认模型或免审执行权限。
- 不修改 Codex、Claude、OpenCode、Grok 的模型编辑/选择语义。
- 不允许执行 profile 未声明或 ACP 未公布的模型，不将密钥值写入仓库或运行 patch。

## 验收标准

- [x] 打开或重新选择有效 DSH profile 默认显示 JSON；JSON 与可视化继续编辑同一份有效配置，保存并重新打开内容不丢失。
- [x] 可视化编辑不显示 `apiKeyEnv` 字段；缺失时保存内容及运行 patch 均规范化为 `SINITEK_DSH_API_KEY`。
- [x] 可视化模型编辑器复用现有模型工作区语义：左侧按配置顺序列出模型，右侧展示并编辑当前模型；`acpModel` 下拉选项严格来自已配置模型。
- [x] 对话选择器列出 DSH profile 的全部配置模型但不提供通用模型管理入口；选择写入对应配置档案的选择状态。
- [x] DSH 提示词执行把所选模型映射为已配置 provider wire，并在 ACP 已公布候选内调用并确认 `session/set_config_option`；无效选择失败关闭。
- [x] 相关构建、单测、文档和 Ontology 校验通过；无关既有工作区修改保持不变。

## 影响面

- 代码目录：`media/config/assets/config-app-ui.js`、`src/config/configService.ts`、`src/config/dshConfig.ts`、`src/cli/dshConfigModels.ts`、`src/extensionHost/cliModelSelectionStrategies.ts`、DSH ACP runner/宿主代码、Webview 模型选择器及对应回归测试。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`。
- 配置与脚本：无。

## 风险与缓解

- 风险：把 DSH 增加到“可选择模型”判断时误开放通用模型管理功能。
- 缓解：拆分模型可选能力与模型管理能力；DSH 只消费配置模型列表，不出现新增/管理伪选项。
- 风险：模式切换或模型删除/重命名令选中项与默认模型失配。
- 缓解：以配置文档模型列表为候选，列表选中项无效时回退 `acpModel`，更新/删除后同步列表选中状态。
- 风险：UI 候选出现但执行路由仍使用旧模型或别名。
- 缓解：验证选择状态、提示词 `model` 输入、provider wire、ACP `setModel` 确认四个边界，并保留现有 fail-closed 校验。

## 验证计划

- 最小相关验证：配置页和 Webview 模型选择单测、DSH 模型选择及 interactive turn 单测。
- 单元自测命令：`node --test dist/test/config/dshconfigpage.test.js dist/test/webview/dshmodelselection.test.js dist/test/extensionHost/dshModelSelection.test.js dist/test/extensionHost/dshInteractiveHostWire.test.js dist/test/interactive/dshRunner.test.js`（以实际测试文件名为准）。
- 扩展验证：`npm run build`、相关 DSH interactive boundary 测试、`node --check media/config/assets/config-app-ui.js`、`npm run validate:whitespace`、`git diff --check`、Ontology 校验。DSH 配置页运行在 VS Code Webview；未启动图形 Extension Host，且仓库 Chromium 冒烟技能要求独立 Web 前后端，因此本次未做浏览器/图形点击验收。

## 测试与清单同步

- 单元测试新增/更新：配置页默认模式/布局/规范化、DSH chat selector options 与模式可见性、选择状态/执行 wire 的端到端覆盖。
- 单元自测结果：`npm run build` 通过；9 个相关测试文件共 66 项，65 项通过、0 项失败、1 项跳过。跳过项为需配置本机 loopback 网关及 `SINITEK_DSH_LIVE=1` 的 opt-in 网关实跑。`node --check media/config/assets/config-app-ui.js`、`npm run validate:whitespace`、`git diff --check` 和 Ontology 校验均通过。
- 失败处理记录：无失败；没有配置本机网关，因此 opt-in 实际网关测试未执行。未做图形 Extension Host 点击验收。
- 功能清单：已同步 DSH 多模型配置、聊天切换、JSON 默认模式、双栏可视化及自动补齐 `apiKeyEnv`。
- 相关文档同步：已同步 CLI 能力规格、运行时参考和 DSH Ontology，遵循当前 profile schema、配置模型候选和 ACP 执行边界。

## 任务列表

- [x] 核对配置解析与运行时模型选择调用链。
- [x] 调整默认 JSON 模式与双栏可视化编辑。
- [x] 接通聊天模型列表与选择状态执行。
- [x] 补回归测试并同步功能规格与 Ontology。
- [x] 执行构建、单测与文档校验并归档计划。

## 决策记录

- 2026-10-25：沿用本工作区既有 DSH 改动，不创建 worktree，以避免覆盖未提交的 DSH 集成工作。
- 2026-10-25：复用 `.grok-model-workspace` / `.grok-model-sidebar` / `.grok-model-detail` 已有布局样式，不新增主题 token 或硬编码颜色。
- 2026-10-25：DSH 模型选择 UI 使用现有 `selectCliModel` 与配置隔离 store；真实执行继续通过 `resolveDshModelWireForRun` 及 ACP `session/set_config_option`。
- 2026-10-25：聊天选择状态读取必须走 DSH profile 专用策略并验证配置候选；仅写入共享 `selectedByConfigId` 后按旧白名单读取会回退默认模型，不能保证真实切换。

## 当前结论

DSH 配置页默认 JSON 模式、可视化双栏有序模型列表与详情、`acpModel` 下拉选择、隐藏并自动补齐 `apiKeyEnv` 均已实现；聊天模型按 profile 配置展示并隔离持久化，执行前将所选 id 解析成已配置 provider wire 并等待 ACP 确认。构建、65 项相关测试、脚本语法、空白和 Ontology 校验通过；1 项 opt-in 网关测试跳过，图形 Extension Host 验收未做。
