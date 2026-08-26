# OpenCode 配置模型选择器与回退修复

- 日期：2026-08-25
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-25
- claim_ttl：已完成
- handoff_to：

## 背景

OpenCode 配置页的主模型仍使用文本组合框，和同组单选下拉控件不一致；配置页还展示不需要的子模型字段。AI 对话面板切换模型时，异步配置状态刷新可能用旧默认模型覆盖刚选择的模型。

## 目标

- 主模型使用与其他配置字段一致的单选下拉组件。
- 配置页不再展示子模型编辑字段，同时保留运行时对既有 `small_model` 的兼容能力。
- OpenCode 模型选择在配置切换竞态下不回退到默认模型。

## 范围

- `media/config/assets/config-app-ui.js` 配置编辑器。
- `src/sessionMessageHandlers.ts` 与 Webview 模型选择回归链路。
- 相关单元测试、OpenCode 事实来源文档和避坑记录。

## 非目标

- 不移除 OpenCode 运行时 Loop/Graph 的子模型角色。
- 不更换 UI 框架、CLI 版本或模型供应商。

## 验收标准

- [x] 主模型渲染为现有单选下拉组件并跨越可视化表单整行。
- [x] 配置页不再渲染子模型字段，既有 `small_model` 保存与运行兼容不被破坏。
- [x] 模型切换消息绑定配置 ID，旧配置面板快照不会覆盖新选择。
- [x] 相关构建、测试和文档校验通过。

## 影响面

- 代码目录：`media/config/assets/`、`src/sessionMessageHandlers.ts`、`src/test/`。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`、`.ch/docs/runbooks/`。
- 配置与脚本：无。

## 风险与缓解

- 风险：移除编辑字段时误删现有 `small_model`。
  - 缓解：视觉状态仍从原始 JSON 保留该字段，序列化不主动删除；仅隐藏配置页编辑控件。
- 风险：异步配置切换期间面板状态短暂来自旧配置。
  - 缓解：消息携带显式 `configId`，配置不一致时跳过旧快照发布，等待应用配置后的状态刷新。

## 验证计划

- 最小相关验证：OpenCode 配置编辑器、Webview 模型选择和消息处理测试。
- 单元自测命令：`npm run build`；`node --test dist/test/opencodeconfigvisualeditor.test.js dist/test/opencodedualmodelwebview.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js`。
- 扩展验证：`node --check media/config/assets/config-app-ui.js`、`git diff --check`、Ontology 校验。

## 测试与清单同步

- 单元测试新增/更新：更新主模型控件和子模型隐藏断言，新增配置竞态回归断言。
- 单元自测结果：`npm run build` 通过；9 个相关测试文件共 `104/104` 通过，包括配置编辑器、`small_model` 兼容、OpenCode 主/子模型状态、模型切换消息和宿主消息处理回归。
- 失败处理记录：无失败。
- 功能清单：已更新 OpenCode 可视化配置与模型选择行为。
- 相关文档同步：已更新 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `.ch/docs/runbooks/PITFALLS.md`。

## 任务列表

- [x] 修改配置页主模型控件并隐藏子模型字段。
- [x] 加固模型切换的配置竞态处理。
- [x] 更新测试、事实来源并完成验证。

## 决策记录

- 2026-08-25：只移除配置页子模型编辑入口，不移除运行时 `small_model` 兼容字段。

## 当前结论

已完成。配置页主模型改用现有 `renderOpenCodeSelect`，该组件以 `width: "100%"` 和 `gridColumn: "1 / -1"` 跨越可视化表单整行；子模型编辑入口不再渲染，底层 `small_model` 仍由原始 JSON 状态保存和运行时链路兼容。

AI 对话面板在发送 `updateOpenCodeRoleModel` 时携带当前 `configId`，宿主优先使用该配置 ID。Webview 在异步状态刷新中暂存待确认的角色选择；当旧快照仍返回 `myAPI/gpt-5.6-sol` 时，刚选择的 `myAPI/gpt-5.5` 不会被覆盖，收到确认快照后清除待确认状态。

验证结论：`npm run build`、9 个相关测试文件（`104/104`）、`node --check media/config/assets/config-app-ui.js`、`git diff --check`、Impeccable detector（`[]`）和 Ontology 校验均通过。本机只读验证确认 OpenCode `1.18.9`、真实 `~/.opencode/config.json` 可解析、默认模型和 `small_model` 兼容字段均存在且无解析问题；未改写用户配置。

Chromium 浏览器验证：桌面视口中主模型单选和所在表单网格均为 `1011px`，窄屏视口中两者均为 `330px`；`small_model` 编辑控件数量为 `0`，未出现控制台、页面或网络错误。
