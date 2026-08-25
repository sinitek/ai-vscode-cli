# 聊天面板宽度与 OpenCode 模型切换修复

- 日期：2026-08-25
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-25
- claim_ttl：当前会话
- handoff_to：

## 背景

聊天面板中的表单控件仍未占满其所属容器宽度；用户还观察到 OpenCode 在切换模型时可能失败并回退为默认模型。

## 目标

修复表单宽度约束，并确保已选择的 OpenCode 模型在 UI、配置持久化和运行请求间保持一致。

## 范围

- `media/config/assets/` 中聊天面板及配置编辑器的相关布局样式与消息逻辑。
- `src/` 中 OpenCode 模型选择、配置写入和请求参数链路。
- 相关单元测试与功能清单。

## 非目标

- 不更换 UI 框架、CLI 版本或模型提供商。
- 不修改无关的 CLI 配置字段。

## 验收标准

- [x] 目标表单控件在所属表单可用宽度内占满整行。
- [x] 切换 OpenCode 模型后，后续运行使用该选择而非回退默认模型。
- [x] 覆盖关键回归路径的相关单元测试和构建通过。

## 影响面

- 代码目录：`media/config/assets/`、`src/webview/`、`src/config/`、`src/cli/`。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 配置与脚本：无预期变更。

## 风险与缓解

- 风险：样式的父级限制可能导致仅改控件本身无效。
- 缓解：沿 DOM 层级验证实际布局规则，并以样式单测覆盖。
- 风险：模型名、provider 与 OpenCode CLI 参数的归属不一致。
- 缓解：追踪 Webview 到配置和命令构建的完整数据流，并覆盖选择后执行的断言。

## 验证计划

- 最小相关验证：运行相关 `node --test dist/test/...` 测试。
- 单元自测命令：`npm run build` 后执行相关测试文件。
- 扩展验证：若可在无写入本地用户配置前提下完成，检查 OpenCode CLI 参数构建。

## 测试与清单同步

- 单元测试新增/更新：更新 OpenCode Webview、消息处理、配置布局和视觉编辑器断言。
- 单元自测结果：`npm run build` 通过；相关 8 个测试文件共 95 个测试通过。
- 失败处理记录：首次构建发现新增正则未转义 `/`，已修正后重跑通过。
- 功能清单：现有 OpenCode Vibe/Coding 主模型和按 config id 隔离覆盖描述已覆盖本次行为，无需重复改写。
- 相关文档同步：新增 `.ch/docs/runbooks/PITFALLS.md` 竞态规避条目；Ontology 校验通过。

## 任务列表

- [completed] 定位布局和 OpenCode 模型选择的实现链路。
- [completed] 最小范围修复并补齐回归测试。
- [completed] 构建、运行相关测试并同步文档。

## 决策记录

- 2026-08-25：先沿现有 Webview 到扩展宿主的消息协议定位根因，避免仅在 UI 上掩盖模型回退。

## 当前结论

已完成：配置中心字段跨完整网格行；OpenCode 模型选择消息绑定配置 ID，避免异步 active config 竞态导致回退默认模型。
