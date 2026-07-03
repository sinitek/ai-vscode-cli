# 仓库工作指南

## 使命

- 这个仓库是一个面向 `Codex CLI` 的重度 harness 模式项目骨架。
- 目标是让代理在超复杂、长周期、跨前后端、跨团队的 ToB 系统中保持可理解、可执行、可收尾。

## 第一次进入仓库时先看

- `README.md`
- `ARCHITECTURE.md`
- `.ch/docs/README.md`
- `.ch/docs/MEMORY.md`
- 如果存在，优先看 `.ch/docs/handoffs/` 中最新 handoff
- `.ch/docs/memory/README.md`
- 如果存在，优先看 `.ch/docs/generated/memory-index/index.md`
- 如果存在，优先看 `.ch/docs/generated/task-board/task-board.md`
- 如果任务范围大、上下文分散，先运行 `memory-recall` 并阅读 `.ch/docs/generated/memory-index/recall-pack.md`
- 如果仓库启用了 CodeGraph（MCP 可用或存在 `.codegraph/codegraph.db`），代码探索、调用链和影响面分析优先使用 `codegraph` skill
- 与当前任务最相关的主题文档，例如 `.ch/docs/SECURITY.md`、`.ch/docs/RELIABILITY.md`、`.ch/docs/PRODUCT_SENSE.md`、`.ch/docs/TESTING.md`

## 工作方式

- 非平凡任务必须使用任务列表，并保持阶段状态同步。
- 需求不清时，先用带选项的问题缩小范围。
- 多阶段、跨模块、风险较高的工作，先创建或更新 `.ch/docs/exec-plans/active/<YYYY-MM-DD>-<slug>.md`。
- 非平凡任务收尾时，按 `.ch/docs/MEMORY.md` 的记忆金字塔检查是否需要压缩 L1 滚动摘要、抽取 L2 事件、上提 L3 画像或沉淀 L4 程序性经验。
- 根级 `AGENTS.md` 只保留稳定规则与导航；细节知识进入 `.ch/docs/` 或更近的子目录 `AGENTS.md`。
- 优先选择朴素、稳定、可搜索、可复用、可验证的实现。
- 优先复用共享抽象，不复制业务规则。
- 涉及稳定业务逻辑的非平凡改动，默认要补或更新单元测试；如果暂时不补，必须明确记录原因与后续动作。
- 有一定复杂度的功能交付后，必须按项目现有测试体系自动执行单元自测；若缺少统一命令，先从最小相关测试命令或就近模块测试开始。
- 单元自测失败时，先判断失败类型再处理：实现缺陷或测试断言过期要就地修复并重跑；环境、依赖、历史失败或范围外失败要记录证据、影响和下一步，不要为了通过测试改无关代码。
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
- `.agents/profiles/`：Planner / Implementer / Reviewer 等角色契约。
- `.agents/skills/codegraph/`：可选 CodeGraph 语义代码图使用约定。
- `ARCHITECTURE.md`：目标结构、分层边界、扩展规则。
- `.ch/docs/README.md`：文档系统总目录。
- `.ch/docs/MEMORY.md`：记忆分层、上提与清理规则。
- `.ch/docs/handoffs/`：跨会话交接文档与模板。
- `.ch/docs/memory/`：默认优先召回的热区记忆面。
- `.ch/docs/design-docs/`：设计文档与核心信念。
- `.ch/docs/exec-plans/`：执行计划、完成归档、技术债跟踪。
- `.ch/docs/generated/`：生成类清单与索引。
- `.ch/docs/generated/task-board/`：任务工作台的 Markdown / JSON 生成物。
- `.ch/docs/generated/memory-index/`：热区记忆与开放事项的 generated recall 面。
- `.ch/docs/product-specs/`：业务需求与产品规格。
- `.ch/docs/references/`：官方对齐和外部参考。

## 仓库扩张后的做法

- 优先在业务目录附近新增局部 `AGENTS.md`，不要让这个文件无限膨胀。
- 前端、后端、数据、平台、运维、测试目录都应该有各自贴身的局部规则。
- 文档要跟着代码边界走，说明“哪里是事实来源”，而不是写成长篇宣言。
