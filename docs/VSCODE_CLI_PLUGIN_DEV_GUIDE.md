# VS Code CLI 插件开发手册

该文档已收敛为**兼容入口**，详细内容已按 `.ch` 规范拆分：

- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`：当前实际架构、模块职责、扩展规则
- `.ch/docs/references/cli-runtime-reference.md`：CLI 接入事实与参数行为
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`：当前产品能力说明
- `.ch/docs/runbooks/local-development.md`：开发、调试、打包手册

仍保留本文件，是因为根级 `AGENTS.md` 将其视为 CLI 插件开发入口。

## 使用建议

1. 先读运行时架构，确认模块边界
2. 再读 CLI 接入参考，确认当前能力是否已落地
3. 修改用户可见能力时，先同步产品规格与功能总表
4. 本地验证和打包流程统一走 runbook
