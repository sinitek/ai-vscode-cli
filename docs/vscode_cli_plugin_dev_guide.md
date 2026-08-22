# VS Code CLI 插件开发指南

本文档是兼容入口。当前开发事实来源请阅读：

- `.ch/docs/references/cli-runtime-reference.md`
- `.ch/docs/references/authoritative-skills.md`
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
- `.ch/docs/runbooks/local-development.md`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

Loop 开发级 Workflow Skills 的运行字段与降级、内置快照来源与许可、同步测试与 VSIX 核验，分别以以上 CLI 运行时参考、权威 Skills 文档和本地开发 runbook 为准；本兼容入口不复制完整规则。

新增或修改用户可见能力时，需要同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。长期记忆能力的设计口径见 `docs/long_term_memory_design.md`。

OpenCode 主模型/子模型与思考力度的实现事实以 `.ch/docs/references/cli-runtime-reference.md` 和 `.ch/docs/design-docs/vscode-cli-extension-runtime.md` 为准：两个角色的候选只从 active config 的 `provider.<id>.models` 加载；主模型通过 `--model` / `--variant` 运行，子模型通过 runtime config overlay 写入 OpenCode CLI 兼容字段 `small_model`，内部 `small: true` 请求只使用该角色模型自身 `options` 并忽略 `variants`。

Loop / Graph 模型选择按 CLI 能力区分：Claude 不显示插件侧模型选择；Codex 普通 Coding 使用单模型，切到 Loop 或 Graph 时显示“主模型 / 子模型”；OpenCode 同样使用主模型 / 子模型口径，底层 `model` / `small_model` 只作为 OpenCode CLI 配置字段适配。Loop 主任务、主持/复核和续跑使用主模型，Loop 子任务使用子模型；Graph planner 和最终 `summary` 节点使用主模型，Graph 其他执行节点使用子模型。

Codex、Claude 和 OpenCode Vibe/coding 人工交互表单由全局工具设置 `humanInteractionEnabled` 控制，默认开启。运行时会拦截结构化 Codex app-server 人工澄清请求；当用户明确要求 AI 先询问需求/细节但模型只返回普通问题列表时，三组 CLI 都会兜底转为同一人工交互表单，并把问题里的“可选 / 选项 / 例如 / 如”候选项以及紧随问题的 `A.` / `B.` / `C.` 字母选项列表渲染成 radio/checkbox。提交继续、拒绝终止；详细边界以 `.ch/docs/design-docs/vscode-cli-extension-runtime.md` 和 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 为准。

Claude 配置卡片的实现事实以 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 和 `.ch/docs/references/cli-runtime-reference.md` 为准：`~/.claude/settings.json` 支持可视化与 JSON 双模式；可视化只定向维护官方常用核心字段和三档默认模型环境变量，序列化必须保留未知字段与额外环境变量。 Claude / OpenCode / Codex 三组可视化参数 label 右侧必须提供问号 tooltip，枚举参数列出可选值；“查看范例”统一放在配置文件名右侧。

Codex 配置卡片的实现事实以 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 和 `.ch/docs/references/cli-runtime-reference.md` 为准：`~/.codex/config.toml` 是 TOML 主配置，不是 JSON；页面保留常用字段可视化编辑、TOML 源码编辑和既有 `auth.json` 入口，不展示、读取或写入 `~/.codex/.env`，也不删除用户已有文件。配置页空白排查应先看本插件 Webview 渲染和配置解析；`AugmentExtensionSidecar` 403 是外部扩展请求失败口径，不能单独作为本插件配置页空白根因。
