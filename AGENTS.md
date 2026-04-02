# AGENTS

本项目是 VS Code 插件。

作用：在 VS Code 中提供内置 AI 对话面板，调用本地 CLI（如 codex / gemini / claude）执行对话请求并展示结果。

# CLI 助手调用手册
- docs/cli-reference.md（兼容入口）
- docs/VSCODE_CLI_PLUGIN_DEV_GUIDE.md（兼容入口）
- 详细事实来源：`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/runbooks/local-development.md`
当你发现这些手册写得不对或者需要补充时，优先同步 `.ch` 事实来源，并保持入口文件可导航。

# 开发注意事项
- 本插件有国际化功能，支持中英文，新增修改功能时务必支持国际化。

# 本工具存储数据
~/.sinitek_cli/

# 本工具功能清单
- docs/插件功能清单.md（兼容入口）
- 详细事实来源：`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`
你在新增修改功能后要同步更新事实来源文档，并保持入口文件可导航。

# 其它
如果有改动，确保 media/official_skills_catalog.json 文件里的 description 翻译成中文

# 仓库工作指南

## 使命

- 这个仓库是一个面向 `Codex CLI` 的重度 harness 模式项目骨架。
- 目标是让代理在超复杂、长周期、跨前后端、跨团队的 ToB 系统中保持可理解、可执行、可收尾。

## 第一次进入仓库时先看

- `README.md`
- `ARCHITECTURE.md`
- `.ch/docs/README.md`
- 与当前任务最相关的主题文档，例如 `.ch/docs/SECURITY.md`、`.ch/docs/RELIABILITY.md`、`.ch/docs/PRODUCT_SENSE.md`、`.ch/docs/TESTING.md`

## 工作方式

- 非平凡任务必须使用任务列表，并保持阶段状态同步。
- 需求不清时，先用带选项的问题缩小范围。
- 多阶段、跨模块、风险较高的工作，先创建或更新 `.ch/docs/exec-plans/active/<YYYY-MM-DD>-<slug>.md`。
- 根级 `AGENTS.md` 只保留稳定规则与导航；细节知识进入 `.ch/docs/` 或更近的子目录 `AGENTS.md`。
- 优先选择朴素、稳定、可搜索、可复用、可验证的实现。
- 优先复用共享抽象，不复制业务规则。
- 涉及稳定业务逻辑的非平凡改动，默认要补或更新单元测试；如果暂时不补，必须明确记录原因与后续动作。
- 功能、行为、权限、流程发生变化时，要同步更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 或明确记录为何无需更新。
- 严禁基于猜测的数据结构继续开发；输入边界、外部接口、配置、事件都要先校验再使用。
- 行为、接口、架构、运维方式发生变化时，同步更新对应文档。
- 一旦发现真实踩坑、隐式前置条件或高复发问题，必须记录到 `.ch/docs/runbooks/PITFALLS.md` 或对应事实来源文档，沉淀为未来的避坑指南。
- 验证先从最小相关范围开始，再扩到更大范围。

## 核心约束

- 不在未获批准时替换技术栈、框架或关键基础设施。
- skills 和 MCP 以少为先，只保留高频、高价值、低噪音项。
- 不做无关大改；修改要尽量贴近根因。
- 不把密钥、令牌、生产地址、客户数据写入仓库。

## 仓库地图

- `AGENTS.md`：仓库级总入口。
- `.codex/config.toml`：项目级 Codex 配置与 MCP（如果仓库启用）。
- `.agents/skills/`：仓库级技能。
- `ARCHITECTURE.md`：目标结构、分层边界、扩展规则。
- `.ch/docs/README.md`：文档系统总目录。
- `.ch/docs/design-docs/`：设计文档与核心信念。
- `.ch/docs/exec-plans/`：执行计划、完成归档、技术债跟踪。
- `.ch/docs/generated/`：生成类清单与索引。
- `.ch/docs/product-specs/`：业务需求与产品规格。
- `.ch/docs/references/`：官方对齐和外部参考。

## 仓库扩张后的做法

- 优先在业务目录附近新增局部 `AGENTS.md`，不要让这个文件无限膨胀。
- 前端、后端、数据、平台、运维、测试目录都应该有各自贴身的局部规则。
- 文档要跟着代码边界走，说明“哪里是事实来源”，而不是写成长篇宣言。
