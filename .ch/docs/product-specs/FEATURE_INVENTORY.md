# 功能总表

这个文件是当前仓库功能清单的**单一事实来源**。

当前仓库已经具备真实能力，因此不再保持空表；请在用户可感知能力发生变化时同步更新。

## 更新规则

- 新增能力时新增一行。
- 修改已有能力时更新状态、角色、规格来源、测试状态和备注。
- 下线能力时不要直接删除，改成 `removed` 并保留历史说明。
- 如果一个功能变更无法直接链接到规格，至少要能链接到执行计划或设计文档。

## 状态枚举

- `proposed`
- `in-progress`
- `active`
- `deprecated`
- `removed`

## 当前清单

| 业务域 | 功能名称 | 状态 | 主要角色 | 规格来源 | 实现位置 | 测试状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 插件入口 | Activity Bar 面板与状态栏入口 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/viewProvider.ts` | manual | 含命令面板入口 |
| CLI 统一接入 | Codex / Claude / Gemini 多 CLI 切换 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/cli/*`, `src/extension.ts` | manual | 命令与参数可分别配置 |
| 执行模式 | Codex / Claude 交互式续接 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/interactive/*`, `src/extension.ts` | manual | 维护底层 thread/session 映射 |
| 执行模式 | Gemini 一次性流式执行 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/cli/commandRunner.ts`, `src/extension.ts` | manual | 当前未接入交互 Runner |
| 会话管理 | 多标签并行会话与历史记录 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/viewContent.ts` | manual | 含 session、tab、prompt history |
| Prompt 增强 | 当前文件/选区上下文注入 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/types.ts` | manual | 由编辑器上下文生成标签 |
| Prompt 增强 | 路径选择器与 `@` 路径插入 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/viewContent.ts` | manual | 依赖工作区文件搜索 |
| 附件能力 | 上传附件与 Codex 图片桥接 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/cli/commandRunner.ts` | manual | 临时文件落盘到 `~/.sinitek_cli/temp/` |
| 输出渲染 | Markdown / trace / task list 展示 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/webview/viewContent.ts`, `src/trace/*` | manual | 区分 thinking、tool-use、普通输出 |
| 运行观测 | 当前 prompt、原始流消息与导出 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/viewContent.ts` | manual | 支持 TXT 导出 |
| 交互控制 | Thinking mode / interactive mode / 模型管理 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/cli/config.ts`, `src/cli/modelArgs.ts`, `src/webview/viewContent.ts` | manual | 模型数据保存在 `~/.sinitek_cli/models.json` |
| 规则管理 | Global / Project 规则读写 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/extension.ts`, `src/webview/viewContent.ts` | manual | 覆盖 Codex / Claude / Gemini |
| 配置中心 | 配置档案、应用、备份、导出 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/webview/configPanel.ts`, `src/config/configService.ts` | manual | 独立 WebviewPanel |
| 平台集成 | Skills 管理（Codex / Claude / Gemini） | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/config/*Skills.ts`, `src/config/configService.ts` | manual | 支持本地扫描与内置官方目录 |
| 平台集成 | MCP 市场、安装、卸载、健康检查 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/config/configService.ts`, `media/mcp_marketplace.json` | manual | 多平台真实命令安装 |
| 稳定性 | 国际化、日志、错误诊断与清理 | active | 开发者 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | `src/i18n.ts`, `src/logger.ts`, `src/errorDisplay.ts` | manual | 包含 Webview 回退页与日志保留 |
