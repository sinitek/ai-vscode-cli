# OpenCode 提供商与思考力度下拉配置

- 日期：2026-07-12
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-12
- claim_ttl：1d
- handoff_to：

## 背景

携宁 CLI 配置页面的 OpenCode 可视化编辑器目前把 provider `npm` 和模型思考力度作为自由文本输入，且多个思考力度入口只展示到 `high`，容易遗漏已支持的 `xhigh` 与 `max`。

## 目标

统一把思考力度选项补全为 `low / medium / high / xhigh / max`，并把 OpenCode provider `npm` 与模型思考力度改为明确的下拉选择交互；provider 适配器至少覆盖 OpenAI compatible、OpenAI、Anthropic 与 Google 官方 AI SDK 包。

## 范围

- OpenCode 可视化配置编辑器字段与序列化逻辑。
- 聊天面板中静态思考力度下拉的完整选项。
- 中英文国际化文案、相关单元测试与功能事实文档。

## 非目标

- 不改变 OpenCode 配置文件结构。
- 不替换现有技术栈或 UI 框架。
- 不修改与本需求无关的未提交改动。

## 验收标准

- [x] 所有静态思考力度选择均包含 `low / medium / high / xhigh / max`。
- [x] OpenCode provider `npm` 使用单选下拉，并包含 Google 适配器。
- [x] OpenCode 模型思考力度使用可多选的下拉交互并正确生成 variants/options。
- [x] 中英文文案与功能清单同步。
- [x] 相关单测和 `npm run build` 通过。

## 影响面

- 代码目录：`media/config/`、`src/webview/`、`src/test/`
- 文档目录：`.ch/docs/product-specs/`
- 配置与脚本：无技术栈变化

## 风险与缓解

- 风险：已有自定义 npm 包或自定义思考力度可能在编辑后丢失。
- 缓解：下拉保留当前未知值作为兼容选项；只规范新增和常用选择。

## 验证计划

- 最小相关验证：OpenCode 可视化编辑器测试、思考力度 Webview 测试。
- 单元自测命令：`node --test dist/test/opencodeconfigvisualeditor.test.js dist/test/openCodeThinkingWebview.test.js`
- 扩展验证：`npm run build`

## 测试与清单同步

- 单元测试新增/更新：更新 OpenCode、Claude、Codex 配置编辑器和聊天 Webview 回归测试。
- 单元自测结果：`npm run build` 通过；4 个测试文件共 33 个用例通过。
- 失败处理记录：首次运行仅新增测试的正则方向错误，修正断言后重跑通过，非实现缺陷。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 定位页面与现有逻辑
- [x] 实现下拉选择和完整力度
- [x] 补齐国际化与测试
- [x] 同步功能事实文档
- [x] 完成构建验证并归档

## 决策记录

- 2026-07-12：provider `npm` 采用单选；模型思考力度采用原生 `select multiple`，并保留未知旧值以兼容手写配置。

## 当前结论

已完成 OpenCode provider npm 单选、模型思考力度多选、全量 `xhigh/max` 补齐、文档同步与自动验证。
