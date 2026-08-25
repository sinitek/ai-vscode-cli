# OpenCode 配置模型选择器与回退修复

- 日期：2026-08-25
- 状态：in-progress
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-25
- claim_ttl：当前会话
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

- [ ] 主模型渲染为现有单选下拉组件并占满字段宽度。
- [ ] 配置页不再渲染子模型字段，既有 `small_model` 保存与运行兼容不被破坏。
- [ ] 模型切换消息绑定配置 ID，旧配置面板快照不会覆盖新选择。
- [ ] 相关构建、测试和文档校验通过。

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
- 单元自测结果：待执行。
- 失败处理记录：待执行。
- 功能清单：复核 OpenCode 模型选择与运行时子模型描述。
- 相关文档同步：待执行。

## 任务列表

- [ ] 修改配置页主模型控件并隐藏子模型字段。
- [ ] 加固模型切换的配置竞态处理。
- [ ] 更新测试、事实来源并完成验证。

## 决策记录

- 2026-08-25：只移除配置页子模型编辑入口，不移除运行时 `small_model` 兼容字段。

## 当前结论

正在修改配置页控件和模型切换竞态保护。
