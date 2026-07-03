# 权威技能候选清单

- 适用对象：需要为复杂仓库维护一套可复制、可审查的 Codex harness starter。
- 目标：记录值得长期关注的外部技能来源、适用边界和引入前检查项。
- 维护要求：仅保留跨项目可复用的信息，不记录本机路径、个人安装痕迹或一次性评估过程。

## 选型原则

只有同时满足下面条件的技能，才适合进入这个目录：

- 来源权威：优先官方仓库或明确维护者的稳定社区仓库。
- 通用价值高：能改善计划、验证、评审、修复、回归或线上反馈等常见闭环。
- 噪音可控：不会显著增加默认上下文负担，也不会强行绑定单一平台。
- 易审查：具备清晰的上游路径、说明文档、许可信息和依赖前置条件。
- 易更新：可以独立安装、独立升级，并记录来源版本。

## 已登记的权威来源

### 1. OpenAI Skills

- 仓库：`https://github.com/openai/skills`
- 说明：这是 Codex 官方维护的技能目录，适合作为默认首选来源。
- 适用建议：优先从这里选择通用、闭环型的 curated skills。

### 2. Hugging Face Skills

- 仓库：`https://github.com/huggingface/skills`
- 说明：仓库规范完整，但当前内容更偏 Hugging Face / ML / 数据与训练工作流。
- 适用建议：仅在目标项目本身依赖相关 AI/ML 流程时再纳入评估。

## 默认候选

### 仓库内置技能说明

- `repo-indexer` 是仓库导航事实与任务级侦察的统一入口；旧的 `repo-radar` 仅保留兼容说明，不再作为同等级独立能力维护。
- 外部 skill 候选只记录值得引入或评估的上游能力，不用于拆分仓库内置说明书。

### 1. `gh-fix-ci`

- 来源：OpenAI curated skill
- 上游路径：`openai/skills -> skills/.curated/gh-fix-ci`
- 链接：`https://github.com/openai/skills/tree/main/skills/.curated/gh-fix-ci`
- 适用场景：GitHub Actions 失败排查、CI 修复、回归验证。
- 采用建议：依赖 GitHub PR 和 GitHub Actions 的团队可优先评估。

### 2. `gh-address-comments`

- 来源：OpenAI curated skill
- 上游路径：`openai/skills -> skills/.curated/gh-address-comments`
- 链接：`https://github.com/openai/skills/tree/main/skills/.curated/gh-address-comments`
- 适用场景：处理 PR review 评论、组织修复计划、跟踪评论闭环。
- 采用建议：适合评审链路较长、多人协作的仓库。

### 3. `playwright`

- 来源：OpenAI curated skill
- 上游路径：`openai/skills -> skills/.curated/playwright`
- 链接：`https://github.com/openai/skills/tree/main/skills/.curated/playwright`
- 适用场景：浏览器自动化、UI 回归、截图验证、复杂交互排查。
- 采用建议：适合存在后台、工作台或多角色前端流程的项目；通常要求本机具备 Node 和 `npx`。

### 4. `security-threat-model`

- 来源：OpenAI curated skill
- 上游路径：`openai/skills -> skills/.curated/security-threat-model`
- 链接：`https://github.com/openai/skills/tree/main/skills/.curated/security-threat-model`
- 适用场景：系统设计评审、权限边界梳理、上线前安全风险检查。
- 采用建议：适合多租户、导入导出、权限治理或外部集成较多的系统。

## 条件候选

### 1. `sentry`

- 来源：OpenAI curated skill
- 上游路径：`openai/skills -> skills/.curated/sentry`
- 链接：`https://github.com/openai/skills/tree/main/skills/.curated/sentry`
- 适用场景：线上错误分析、事故回溯、告警驱动修复。
- 采用建议：仅在团队已使用 Sentry 且已配置必要凭据时启用。

### 2. `notion-knowledge-capture`

- 来源：OpenAI curated skill
- 上游路径：`openai/skills -> skills/.curated/notion-knowledge-capture`
- 链接：`https://github.com/openai/skills/tree/main/skills/.curated/notion-knowledge-capture`
- 适用场景：将决策、FAQ、经验总结同步到 Notion。
- 采用建议：适合已把 Notion 作为组织知识库的团队；如果仓库是唯一事实来源，应谨慎默认启用。

### 3. `notion-spec-to-implementation`

- 来源：OpenAI curated skill
- 上游路径：`openai/skills -> skills/.curated/notion-spec-to-implementation`
- 链接：`https://github.com/openai/skills/tree/main/skills/.curated/notion-spec-to-implementation`
- 适用场景：将规格文档转成实现计划、任务拆解和进度回写。
- 采用建议：适合已有 Notion 规格管理流程的团队，不建议作为 starter 默认依赖。

## 引入前检查

在目标项目正式启用外部 skill 前，至少完成下面检查：

1. 核对上游目录、`SKILL.md` 和许可信息是否仍然存在且可用。
2. 检查是否新增脚本、MCP、OAuth、环境变量或高风险外部依赖。
3. 先做用户级安装验证，再决定是否需要 vendoring 到仓库。
4. 如需 vendoring，记录上游仓库、上游路径、核验日期、提交 SHA 和本地改动说明。

## 参考链接

- OpenAI Skills 仓库：`https://github.com/openai/skills`
- OpenAI Skills 文档：`https://developers.openai.com/codex/skills`
- OpenAI Create Skill 文档：`https://developers.openai.com/codex/skills/create-skill`
- Hugging Face Skills 仓库：`https://github.com/huggingface/skills`
