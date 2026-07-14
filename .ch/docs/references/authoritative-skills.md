# 权威 Skills 来源与 Loop 内置快照

- 适用对象：需要维护 Codex harness starter，或维护随 VSIX 分发的 Loop 开发级执行快照。
- 目标：记录值得长期关注的外部 Skill 来源、适用边界、引入前检查项，以及当前 Loop 内置快照的可追溯来源与维护方式。
- 维护要求：外部候选不记录个人安装痕迹；已随扩展分发的受控快照可以记录批准的开发期导入路径，但必须明确它不是运行时依赖。

## 选型原则

只有同时满足下面条件的技能，才适合进入这个目录：

- 来源权威：优先官方仓库或明确维护者的稳定社区仓库。
- 通用价值高：能改善计划、验证、评审、修复、回归或线上反馈等常见闭环。
- 噪音可控：不会显著增加默认上下文负担，也不会强行绑定单一平台。
- 易审查：具备清晰的上游路径、说明文档、许可信息和依赖前置条件。
- 易更新：可以独立安装、独立升级，并记录来源版本。

## Loop 内置执行快照

### 定位与隔离

`media/loop-workflow-skills/` 是 Loop 开发级子任务使用的**扩展内置、只读执行快照**。它随 VSIX 分发，由 `manifest.json` 提供唯一 catalog、来源和完整性事实；它不是用户可安装的官方 Skill，也不参与 Codex 对仓库 Skill 的自动发现。

| 目录/资源 | 用途 | 与 Loop 内置快照的关系 |
| --- | --- | --- |
| `media/loop-workflow-skills/` | Loop development 任务的 compact catalog 与受控 guidance | 当前运行时唯一读取的内置 workflow Skill 根 |
| `.agents/skills/` | 当前仓库的 Codex harness Skill | 供开发本仓库的代理按仓库规则发现；不作为 Loop catalog |
| `media/workspace-scaffold/.agents/skills/` | 用户主动安装 harness 时复制到目标工作区的模板 | 属于 workspace scaffold；不被运行时当作内置快照，也不由本同步流程覆盖 |
| `media/official-skills/**`、`media/official_skills_catalog.json` | 配置中心的官方 Skills catalog、安装与版本管理 | 与 Loop workflow pack 分离；不得复用其 catalog 或更新服务 |

首版只把该快照注入 Loop 子任务 model prompt，没有新增 UI、设置或 i18n 文案；非开发任务仍走原 Loop 直接安排，不读取该目录。

### 批准来源、许可与完整性

- 批准的开发期导入内容来自 `/Users/fangjiawei/work/agent-skills/skills`，其依赖闭包还包含同一仓库根下的 `/Users/fangjiawei/work/agent-skills/references`。同步命令必须传仓库根 `/Users/fangjiawei/work/agent-skills`，因为脚本还会校验 `.codex-plugin/plugin.json` 与 `LICENSE`。
- manifest 声明的上游为 `agent-skills`，URL 为 `https://github.com/addyosmani/agent-skills`，版本 `1.0.0`，许可证 MIT。批准的本地导入源不是 Git checkout，因此没有可验证的 upstream commit；不得编造提交 SHA。
- `media/loop-workflow-skills/THIRD_PARTY_LICENSE.md` 是随包 NOTICE/许可载体，记录来源、无法验证 commit 的事实、`Copyright (c) 2025 Addy Osmani` 和完整 MIT 文本。
- 当前 `manifest.json` 索引 24 个 Skill、27 个 Skill Markdown、7 个根 reference，共 35 个 payload 文件、380,502 bytes。`files[]` 为每个 payload 保存 `path`、`bytes`、`sha256`；`skills[]` 复用入口文件的 bytes/hash，并记录 `supportFiles`、phase、task kind、role、capability、priority 与触发条件。
- 当前 `source.snapshotSha256` 为 `2603c030a1ded0bcad531ce189b81d83bef67054ebaa6855e254ff100922bcf8`。该值由排序后的 `files[]` inventory 计算；`manifest.json` 不递归索引自身。
- `supportFiles` 只用于批准依赖闭包和完整性校验。运行时 guidance 只读取被选 Skill 的入口 `SKILL.md`，不会自动递归注入 support 文件。

### 同步与维护

开发期刷新必须显式指定批准的上游根：

```bash
node scripts/sync_loop_workflow_skills.js --source /Users/fangjiawei/work/agent-skills
```

该命令不联网、不 clone/pull。它会核对批准目录集合、插件元数据和 MIT LICENSE，拒绝符号链接、特殊文件、越界路径、非 UTF-8、超限文件与未批准内容；生成 staging 快照并先运行完整 validator，成功后才原子替换 `media/loop-workflow-skills/`，失败时保留旧快照。

只读一致性检查不依赖外部绝对路径：

```bash
node scripts/sync_loop_workflow_skills.js --check
node scripts/validate_loop_workflow_skills.js
```

维护要求：

1. 不在插件运行时调用同步脚本，不从 `/Users/fangjiawei/work/agent-skills`、cwd、workspace、用户 Home 或网络回退加载内容。
2. 不把该快照复制到 `.agents/skills/`、workspace scaffold 或官方 Skills catalog。
3. 刷新后审查 manifest、许可和资源 diff，再按 `.ch/docs/runbooks/local-development.md` 执行 build、定向测试、`vsce ls` 与实际 VSIX 解包逐项比对。
4. 任一 manifest 或资源完整性失败都使整包 catalog 不可用；运行时安全降级为无 catalog/guidance 的原 Loop，不扫描替代目录。

事实来源：`media/loop-workflow-skills/manifest.json`、`media/loop-workflow-skills/THIRD_PARTY_LICENSE.md`、`scripts/sync_loop_workflow_skills.js`、`scripts/validate_loop_workflow_skills.js`、`src/loopSkillGuidance.ts`、`src/test/loopSkillGuidance.test.ts`。

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
