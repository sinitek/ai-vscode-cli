# VS Code CLI 插件开发指南

本文档是兼容入口。当前开发事实来源请阅读：

- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- `.ch/docs/runbooks/local-development.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

新增或修改用户可见能力时，需要同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。长期记忆能力的设计口径见 `docs/long_term_memory_design.md`。

OpenCode 双模型与思考力度的实现事实以 `.ch/docs/references/cli-runtime-reference.md` 和 `.ch/docs/design-docs/vscode-cli-extension-runtime.md` 为准：主模型与小模型候选只从 active config 的 `provider.<id>.models` 加载；主模型通过 `--model` / `--variant` 运行，小模型只能通过 runtime config overlay 覆盖顶层 `small_model`，内部小模型请求只使用自身 `options` 并忽略 `variants`。

Claude 配置卡片的实现事实以 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 和 `.ch/docs/references/cli-runtime-reference.md` 为准：`~/.claude/settings.json` 支持可视化与 JSON 双模式；可视化只定向维护官方常用核心字段和三档默认模型环境变量，序列化必须保留未知字段与额外环境变量。
