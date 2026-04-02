# 权威技能目录（少而硬）

- 核验日期：2026-03-28
- 目标：只记录**值得长期保留关注**、且来源足够权威的外部技能。
- 适用对象：复杂、长周期、百万行级别前后端全栈 ToB 系统的 Codex harness。

## 选型原则

只有同时满足下面条件的技能，才值得进入这个目录：

- 来源权威：优先 `openai/skills` 官方仓库；必要时才考虑其他权威社区仓库。
- 通用价值高：能提升复杂仓库的完成率，而不是只服务于非常窄的场景。
- 能闭环：最好直接改善计划、验证、评审、修复、上线反馈中的某一个闭环。
- 噪音可控：不会把仓库默认上下文变得更乱。
- 易更新：有清晰上游路径、独立 `SKILL.md`、最好带 `LICENSE.txt` 和脚本/参考资料。

## 我实际核对过的来源

### 1. OpenAI 官方技能仓库

- 仓库：`https://github.com/openai/skills`
- 依据：仓库 README 明确说明这是 Codex 可使用和分发的技能目录；`.system` 技能会随新版 Codex 自动安装，`.curated` 技能可通过 `skill-installer` 安装。
- 结论：这是当前最权威、最直接面向 Codex 的技能来源。

### 2. Hugging Face Skills 仓库

- 仓库：`https://github.com/huggingface/skills`
- 结论：它是权威且规范的 Agent Skills 仓库，但当前技能几乎都聚焦 Hugging Face / ML / 数据集 / 训练工作流。
- 结论补充：对“超复杂 ToB 全栈业务系统”的默认帮助不如 OpenAI 官方 curated skills，因此本轮不纳入默认推荐。

## 默认推荐补充的外部技能

下面这些技能，我认为值得进入这套 harness 的“常备候选清单”。

### 1. `gh-fix-ci`

- 来源等级：OpenAI 官方 curated skill
- 来源路径：`openai/skills -> skills/.curated/gh-fix-ci`
- 来源链接：`https://github.com/openai/skills/tree/main/skills/.curated/gh-fix-ci`
- 为什么重要：大型仓库里，CI 失败本身就是高频反馈源。这个技能把“查 PR checks → 拉日志 → 摘失败片段 → 先出修复计划 → 获批后再动手”的闭环固定下来。
- 对 ToB 大仓库的价值：非常高。它能显著降低跨模块改动后修 CI 的随机性。
- 安装条件：团队使用 GitHub PR + GitHub Actions。
- 默认建议：**推荐**。
- 备注：这个技能自带脚本和 `LICENSE.txt`，适合后续按需用户级安装，不建议一开始就 vendoring 到仓库。

### 2. `gh-address-comments`

- 来源等级：OpenAI 官方 curated skill
- 来源路径：`openai/skills -> skills/.curated/gh-address-comments`
- 来源链接：`https://github.com/openai/skills/tree/main/skills/.curated/gh-address-comments`
- 为什么重要：复杂系统的质量不只取决于“写代码”，还取决于“能否系统化吸收评审反馈”。这个技能把 PR 评论处理流程标准化。
- 对 ToB 大仓库的价值：高。适合长周期协作、多人评审、严格合并流。
- 安装条件：团队以 GitHub PR review 为主。
- 默认建议：**推荐**。

### 3. `playwright`

- 来源等级：OpenAI 官方 curated skill
- 来源路径：`openai/skills -> skills/.curated/playwright`
- 来源链接：`https://github.com/openai/skills/tree/main/skills/.curated/playwright`
- 为什么重要：对复杂后台、管理台、工作台来说，很多问题最终都要落到“真实浏览器里的真实交互”。这个技能把浏览器自动化、截图、表单流程、页面调试固化为 CLI 工作流。
- 对 ToB 大仓库的价值：高。尤其适合复杂表单、审批流、运营后台、多角色 UI。
- 安装条件：本机有 Node / `npx`。
- 默认建议：**推荐**。
- 备注：优先选 `playwright` 本体；`playwright-interactive` 更强，但前置条件也更重，不应作为默认项。

### 4. `security-threat-model`

- 来源等级：OpenAI 官方 curated skill
- 来源路径：`openai/skills -> skills/.curated/security-threat-model`
- 来源链接：`https://github.com/openai/skills/tree/main/skills/.curated/security-threat-model`
- 为什么重要：ToB 系统天然会碰到多租户、权限、集成、导入导出、审计、配置中心等高风险边界。这个技能要求威胁建模必须落到仓库事实上，而不是泛泛 checklist。
- 对 ToB 大仓库的价值：高。尤其适合系统设计阶段、上线前评审、重大集成改造。
- 默认建议：**推荐**。
- 安装条件：无特定外部平台依赖。

### 5. `sentry`

- 来源等级：OpenAI 官方 curated skill
- 来源路径：`openai/skills -> skills/.curated/sentry`
- 来源链接：`https://github.com/openai/skills/tree/main/skills/.curated/sentry`
- 为什么重要：真正的“自我进化”不是一个魔法技能，而是能持续吃到线上反馈并转成修复动作。`sentry` 正好覆盖生产错误/事件读取这一环。
- 对 ToB 大仓库的价值：高。适合线上问题分析、回溯、事故归因。
- 安装条件：团队实际使用 Sentry，并配置本地 `SENTRY_AUTH_TOKEN`。
- 默认建议：**条件推荐**。

## 条件推荐：贴近“长期记忆 / 模块演进”的官方技能

这部分是我针对你提到的两个方向，专门筛出来的最接近官方答案的技能。

### A. `notion-knowledge-capture` —— 最接近“长期记忆”

- 来源等级：OpenAI 官方 curated skill
- 来源路径：`openai/skills -> skills/.curated/notion-knowledge-capture`
- 来源链接：`https://github.com/openai/skills/tree/main/skills/.curated/notion-knowledge-capture`
- 能力定位：把对话、决策、how-to、FAQ、经验总结写进结构化 Notion 页面。
- 为什么不是默认安装：
  - 它把“长期记忆”放进 Notion，而不是仓库。
  - 这和本项目当前坚持的“仓库是第一事实来源”原则存在天然张力。
- 什么时候值得用：
  - 团队已经把 Notion 当组织知识库；
  - 你希望把仓库内计划/结论同步到团队 Wiki，而不是只留在代码仓库。
- 默认建议：**不默认启用，但强烈建议纳入候选清单**。

### B. `notion-spec-to-implementation` —— 最接近“跨模块任务演进”

- 来源等级：OpenAI 官方 curated skill
- 来源路径：`openai/skills -> skills/.curated/notion-spec-to-implementation`
- 来源链接：`https://github.com/openai/skills/tree/main/skills/.curated/notion-spec-to-implementation`
- 能力定位：把 Notion 规格转成实现计划、任务和进度更新。
- 为什么重要：它很接近你说的“执行项目不同模块任务的自我进化”——因为它关注的是：规格 → 计划 → 任务 → 状态追踪 的持续链路。
- 为什么不是默认安装：
  - 依赖 Notion MCP 和团队已有的 Notion 任务/规格体系；
  - 对当前这个“仓库内 harness 骨架”来说，仍然偏组织流程层，不是最小必需项。
- 默认建议：**条件推荐**。

## 当前没有找到的“官方单技能答案”

截至 2026-03-28，我没有在 OpenAI 官方 curated skills 中找到这两类“单技能即完整方案”的官方技能：

### 1. 仓库内长期记忆技能

- 没有找到“把长期记忆直接沉淀到仓库 docs / plans / design-docs，并自动维护索引”的官方现成技能。
- 当前最接近的官方能力，是：
  - `notion-knowledge-capture`
  - `notion-spec-to-implementation`
- 结论：对本仓库来说，长期记忆仍应以 `.ch/docs/`、`exec-plans/`、`design-docs/` 为主，而不是期待一个官方 memory skill 一步到位。

### 2. 单一的“自我进化多模块执行”技能

- 没有找到一个官方 skill 能同时覆盖：规划、跨模块执行、CI 反馈、评审反馈、浏览器回归、线上错误回捞。
- OpenAI 当前更像是把这个闭环拆成多个专长技能：
  - 计划/规格：`notion-spec-to-implementation`
  - PR 评审：`gh-address-comments`
  - CI 修复：`gh-fix-ci`
  - 浏览器验证：`playwright`
  - 线上反馈：`sentry`
- 结论：真正实用的做法不是等一个“万能 skill”，而是保留少数闭环型技能，配合仓库内 harness 文档系统使用。

## 本仓库建议策略

按“默认启用 / 条件启用 / 仅保留来源记录”分三档：

### 默认启用候选（优先级从高到低）

1. `gh-fix-ci`
2. `gh-address-comments`
3. `playwright`
4. `security-threat-model`

### 条件启用候选

1. `sentry`
2. `notion-knowledge-capture`
3. `notion-spec-to-implementation`

### 暂不推荐默认引入

- `linear`：权威、实用，但过度绑定具体项目管理平台。
- `security-ownership-map`：强，但更偏安全治理专项，不是每天都会触发。
- Hugging Face skills 全套：权威，但当前更偏 AI/ML 研发链路，不适合做这套 ToB 骨架的默认技能。

## 安装方式（遵循 Codex 官方约定）

OpenAI 官方仓库 README 与 Codex 系统自带 `skill-installer` 都说明：curated skills 应通过 `skill-installer` 安装。

示例：

- `$skill-installer gh-fix-ci`
- `$skill-installer gh-address-comments`
- `$skill-installer playwright`
- `$skill-installer security-threat-model`
- `$skill-installer sentry`

安装完成后需要重启 Codex。

## 更新与审查规则

以后如果要真的把某个外部 skill 纳入长期使用，按这个顺序做：

1. 先核对上游目录和 `SKILL.md` 是否仍然存在。
2. 检查该技能目录下的 `LICENSE.txt`。
3. 检查是否新增脚本、MCP、OAuth、环境变量或危险前置条件。
4. 先做用户级安装验证，再决定是否要 vendoring 到仓库。
5. 如果要 vendoring，文档里必须记录：
   - 上游仓库
   - 上游路径
   - 核验日期
   - 对应提交 SHA
   - 本地是否做过改动

## 参考链接

- OpenAI 官方技能仓库：`https://github.com/openai/skills`
- OpenAI Skills 文档：`https://developers.openai.com/codex/skills`
- OpenAI Create Skill 文档：`https://developers.openai.com/codex/skills/create-skill`
- OpenAI `skill-installer` 系统技能说明：`/Users/fangjiawei/.codex/skills/.system/skill-installer/SKILL.md`
- Hugging Face Skills 仓库：`https://github.com/huggingface/skills`
