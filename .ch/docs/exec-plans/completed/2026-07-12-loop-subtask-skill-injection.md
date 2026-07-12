# Loop 开发级子任务 Skill 选择与提示词注入

- 日期：2026-07-12
- 状态：completed
- 当前阶段：实施批次 3C 已完成；round 12 五轴终审为 Blocker 0 / Required 0，计划已批准归档
- 负责人：Loop 主任务协作
- owner：Loop 任务 `msg_1783832394276_99722f39c6a9`
- claimed_at：2026-07-12T13:19:49+08:00
- claim_ttl：已于 2026-07-12 完成终审并释放
- handoff_to：Loop 主任务 `msg_1783832394276_99722f39c6a9` 复核 completed 状态

## 背景

用户希望把 `/Users/fangjiawei/work/agent-skills/skills` 中面向高级开发流程的 Markdown 能力吸收到插件项目，并让 Loop 在派发开发级子任务前选择最匹配的内容，作为子任务执行要求的一部分。规划、实现、测试、调试、评审、安全、性能、迁移、发布和与代码直接相关的文档任务可以启用；普通问答、翻译、摘要、内容写作、资料整理、购物/旅行建议等非开发任务继续沿用现有直接派发流程。

阶段 1 已完成外部资源、Loop 接线、打包/文档/测试三项事实审计。本计划不再把资源目录、manifest、字段名、预算、调用链或测试 seam 作为设计 Open Question，而是把审计结论冻结为后续实现契约。后续实现不得绕过本计划另选资源目录、字段或信任边界；如实现证据表明契约不可行，必须先回写本计划并由主任务重新批准。

## 目标

1. 把审计批准的高级开发流程 Markdown 以可追溯、可校验、可随 VSIX 分发的静态快照纳入项目。
2. 为静态快照建立单一可信 manifest，使 Loop 主任务只接触有界 compact metadata，并只返回稳定 skill ID。
3. 采用“宿主双层开发门禁 + 主模型选择 ID + 宿主强校验/生成快照”的方案，禁止模型控制路径或原始 guidance。
4. 仅对开发级 Loop 子任务注入经过验证且预算内的 Markdown；非开发、未知分类和旧记录保持原 Loop 行为。
5. 把宿主确认后的 `skillIds` 和宿主生成的 `skillGuidance` 持久化到子任务记录，保证自动重试新会话使用同一快照。
6. 同时覆盖普通主从与红蓝首轮/后续轮，证明资源在开发态和实际 VSIX 安装态可达。
7. 完成定向测试、构建、相关回归、文档同步、五轴复核和计划归档。

## 范围

- 导入审计批准的 Markdown 依赖闭包、第三方许可和完整性元数据。
- 新增与官方 Skills、仓库 harness Skills、workspace scaffold 隔离的内部资源根。
- 定义 `taskKind`、`skillIds`、`skillGuidance` 三个最小运行时字段及其信任边界。
- 新增纯函数模块，负责 manifest 校验、资源定位、门禁、阶段/角色/能力过滤、排序、预算、内容清洗和诊断。
- 扩展普通主任务 prompt、红蓝 brief/consensus 协议、中央决策应用和子任务 model prompt。
- 保持现有 CLI/model 继承、`writeFiles`/`conflictGroup` 并发、重试、沟通文件和主任务唤醒语义。
- 同步运行时设计、能力规格、功能清单、来源说明、安全、开发 runbook 和真实 PITFALLS。

## 非目标

- 不替换 TypeScript/Node.js、VS Code Extension API、现有 CLI Runner、Loop 编排框架或测试技术栈。
- 不新增 UI、设置、按钮、状态气泡或用户可见错误提示；首版不新增 i18n 文案。
- 不修改或复用 `media/official_skills_catalog.json`、`media/official-skills/**`、官方 Skill 安装/更新/卸载服务。
- 不把内部 workflow skills 放入根 `.agents/skills/` 或 `media/workspace-scaffold/.agents/skills/`。
- 不把外部 `/Users/fangjiawei/work/agent-skills` 作为运行时依赖，不在运行时联网更新。
- 不复制完整上游仓库、`.DS_Store`、上游脚本、`AGENTS.md`、README、插件配置、hooks、commands 或其他仓库文件。
- 不让模型返回路径、`skillGuidance`、CLI、model、command 或其他可改变宿主行为的字段。
- 不允许普通 Loop 子任务自行嵌套派发、commit、branch、push、安装 MCP/CLI 或扩大 `writeFiles`。
- 不在规则中间截断 Markdown，不把全部 skill 正文或全部 support 文件无界拼入 prompt。

## 原始需求到验收映射

| 原始要求 | 冻结实现边界 | 最终验收证据 |
| --- | --- | --- |
| “把这些 skills 的 md 文件放入项目” | 导入 24 个 skill 目录下的完整 Markdown 依赖闭包和 7 个根 reference；保留 MIT 声明与逐文件 hash | sync/validator 结果、manifest inventory/hash、`vsce ls`、实际 VSIX 解包 |
| “安排子智能体前找到最适合的 md 文件” | 根门禁后向主任务提供 compact metadata；主任务按子任务返回 `skillIds`；宿主再按子任务精门禁 | 普通主从和红蓝首轮协议测试、未知 ID/角色/能力拒绝测试 |
| “把 md 内容作为执行要求给到子智能体” | 宿主读取 manifest 固定 `path`，清洗正文并生成有界 `skillGuidance` 快照，插入子任务职责后、当前任务前 | prompt 精确字符串测试、重试快照测试、预算测试 |
| “开发级别任务使用更高级能力” | `taskKind="development"` 且子任务阶段、task kind、角色、能力均兼容时才注入 | 规划、实现、测试、调试、评审、安全、文档等正向用例 |
| “非开发任务按现有流程直接安排” | 根门禁为 `non_development` 或不确定时不向普通主任务/红蓝 brief提供 catalog；子任务也不注入 | 非开发普通主任务、红蓝 brief、子任务 model prompt 与修改前基线逐字相等；任务记录无 skill 字段 |
| “可以有更好方案” | 采用 hybrid 方案；模型只选择 ID，宿主控制路径、完整性、角色、能力、排序、预算和降级 | 路径穿越、模型伪造 guidance、资源损坏、预算超限和 legacy 兼容测试 |

## 阶段 1：并发审计与契约回填（completed）

三个报告均已完整读取，不只依赖任务记录 summary。

| 审计报告 | 已回填事实 | 状态 |
| --- | --- | --- |
| `/Users/fangjiawei/.sinitek_cli/lobster-communications/msg_1783832394276_99722f39c6a9/subtasks/round-1-audit-source-agent-skills.md` | 24/27 inventory、7 个根 reference、MIT/来源缺口、重名/重叠、角色/能力限制、依赖闭包 | completed |
| `/Users/fangjiawei/.sinitek_cli/lobster-communications/msg_1783832394276_99722f39c6a9/subtasks/round-1-audit-loop-skill-injection-seams.md` | 精确调用链、普通/红蓝接缝、决策/Store 字段剥离、重试快照、双层门禁、预算和测试 seam | completed |
| `/Users/fangjiawei/.sinitek_cli/lobster-communications/msg_1783832394276_99722f39c6a9/subtasks/round-1-audit-skill-packaging-docs-tests.md` | `media`/VSIX 边界、extension root 定位、官方/scaffold 隔离、同步/校验、安全、文档和打包测试 | completed |

阶段 1 退出条件：

- [x] 三个审计子任务均为 completed，报告包含事实、证据、风险、验证和建议。
- [x] 三份报告已逐份完整读取。
- [x] 已确认结论已从 Open Questions 移入当前事实与决策记录。
- [x] 资源目录、manifest schema、字段名、门禁、角色、能力、预算、排序和验证命令已冻结。
- [x] 上游 MIT 允许随包分发；来源 commit 不可验证，但通过声明版本和精确快照 hash 补足可追溯性。

## 当前事实

### 外部资源与来源

- 外部源有 24 个一级 skill 目录、24 个 `SKILL.md`、3 个 `idea-refine` 附属 Markdown，共 27 个 `skills/**/*.md`。
- `skills/` 下另有 `idea-refine/scripts/idea-refine.sh` 和 `.DS_Store`；二者都不属于首版批准快照。
- 24 个主文件合计 6,958 行、289,037 bytes；27 个 skill Markdown 合计 7,408 行、320,463 bytes。
- 7 个根级 `references/*.md` 合计 58,466 bytes，分别为 `accessibility-checklist.md`、`definition-of-done.md`、`observability-checklist.md`、`orchestration-patterns.md`、`performance-checklist.md`、`security-checklist.md`、`testing-patterns.md`。
- 只有 `idea-refine` 有 3 个 skill 目录内附属 Markdown：`examples.md`、`frameworks.md`、`refinement-criteria.md`。
- 反引号路径而非 Markdown link 承载主要依赖，因此普通 link checker 不能替代 manifest/supportFiles 校验。
- 上游 manifest 声明名称 `agent-skills`、版本 `1.0.0`、URL `https://github.com/addyosmani/agent-skills`、许可证 MIT、作者 Addy Osmani。
- 上游 LICENSE 为 `Copyright (c) 2025 Addy Osmani`；项目自身 MIT 与其兼容，但必须单独保留上游版权与许可文本。
- 本地外部源不是 Git checkout，精确 commit/tag 和本地是否有未上游改动无法证明。首版不得伪造 commit；以 `source.version=1.0.0` 和批准 payload 的 `snapshotSha256` 作为来源证据。
- 外部 24 个 skill 名称与根 `.agents/skills/`、workspace scaffold 中各 17 个项目 skill 的精确交集均为空；两套项目 skill 彼此同名且内容一致。
- 语义重叠时项目规则优先：`execution-plan` 覆盖外部默认 `tasks/*` 路径；本地 memory/CodeGraph/ownership 规则不被替换；未获授权不得自动 commit/branch/push。

### 资源与 VSIX 边界

- `package.json` 没有 `files` 白名单，当前 `.vscodeignore` 未排除 `media/**`；`vsce ls --no-dependencies` 已证明 `media` 资源会进入包。
- 运行时必须从 `context.extensionUri.fsPath` 对应的扩展安装根解析资源，沿用 `path.join(extensionRoot, "media", ...)` 模式；不得使用 `process.cwd()`。
- `media/workspace-scaffold` 只在用户确认后复制到工作区，且已存在文件不覆盖；内部 workflow skills 放入该目录会产生用户工作区污染和版本漂移。
- 根 `.agents/skills` 会被 Codex/OpenCode 等技能扫描逻辑发现；内部 workflow skills 放入该目录会混入用户可见 Skill 面。
- 官方 catalog/service 会把归档安装到用户 Home 下的 CLI skill 目录；内部 workflow skills 不属于该安装、更新、卸载链路。
- 首版唯一运行时事实源固定为扩展包内 `media/loop-workflow-skills/`。

### Loop 精确调用链与测试 seam

```text
Webview sendPrompt
  -> sessionMessageHandlers.handlePanelMessageWithDeps
  -> sessionMessageActions.handleSendPromptMessage
     -> runLobsterPrompt
  -> extension.runLobsterPromptOrchestration
     -> create/read LobsterTaskRecord
     -> 普通主从:
          buildLobsterMainModelPrompt
        红蓝首轮:
          runLobsterDebateRound
          -> buildLobsterDebateBriefMarkdown
          -> buildLobsterDebateConsensusModelPrompt
          -> decision.json
        红蓝后续轮:
          buildLobsterModeratorMainModelPrompt
          -> buildLobsterMainModelPrompt
     -> parseLobsterMainDecision
     -> normalizeLobsterMainDecision
     -> normalizeSingleLobsterSubtaskDecision
     -> applyLobsterMainDecisionForRun  <-- 普通主从与红蓝共识共同中央校验点
     -> applyLobsterMainDecision
     -> upsertLobsterSubtask
     -> writeLobsterTaskStore
     -> runLobsterSubtasksBatchWithRetry
        -> buildLobsterSubtaskExecutionPlan
        -> runLobsterSubtaskWithRetry
           -> createLobsterSubtaskRunTarget
           -> buildLobsterSubtaskModelPrompt  <-- 宿主 guidance 最终注入点
           -> runLobsterRound(role=subtask)
           -> markLobsterSubtaskRunFinished
```

- 普通主任务 prompt 在 `src/extension.ts` 的 `buildLobsterMainModelPrompt`；红蓝后续轮复用它。
- 红蓝首轮绕过普通主任务 prompt，必须同时修改 `src/lobsterPromptBuilders.ts` 的 debate brief 和 consensus JSON 合约。
- `src/lobsterDebateRunner.ts` 的 `runLobsterDebateConsensusSummary` 直接调用 `buildLobsterDebateConsensusModelPrompt`；因此 2B 必须由 `src/extension.ts` 将与 brief 同源的 catalog section 传入 runner，再由 runner 以末尾可选参数最小透传到 consensus builder。仅修改 `src/extension.ts` 无法完成该同源约束。
- `normalizeSingleLobsterSubtaskDecision` 目前只保留 `id/title/prompt/conflictGroup/writeFiles`；不显式加入 `skillIds` 就会丢失模型选择。
- `applyLobsterMainDecisionForRun` 是普通主从与红蓝共识共同经过的中央宿主校验点。
- `upsertLobsterSubtask` 和 `normalizeLobsterSubtaskRecord` 都必须显式保留新增字段；Store 每次写入前会再次归一化，手工往 JSON 加字段无效。
- `buildLobsterSubtaskModelPrompt` 是新子会话唯一实际 prompt 注入点；display prompt 不承载大段 guidance。
- 自动重试每次创建新子会话，因此必须在首次执行前持久化宿主生成的 `skillGuidance` 快照；重试不得重新读取可能已变化的资源生成不同指导。
- `src/lobsterParallel.ts` 仍只按 `writeFiles/conflictGroup` 分组，不因 skill 字段改变并发。
- CLI/model 仍由父任务与现有 runner 继承；skill 合约无权改变它们。

## 冻结资源契约

### 目录布局

```text
media/loop-workflow-skills/
├── manifest.json
├── THIRD_PARTY_LICENSE.md
├── skills/
│   └── <id>/
│       ├── SKILL.md
│       └── <审计确认的附属 Markdown>
└── references/
    └── <7 个审计确认的 reference Markdown>
```

批准 payload：

- `skills/<id>/SKILL.md`：24 个。
- `skills/idea-refine/examples.md`、`frameworks.md`、`refinement-criteria.md`：3 个。
- `references/*.md`：上述 7 个。
- `THIRD_PARTY_LICENSE.md`：保留上游 MIT 全文、版权、来源名称/URL/声明版本和“精确 commit 不可验证”的说明。
- `manifest.json`：唯一 catalog、来源和完整性事实源。

禁止复制：

- `.DS_Store`、`idea-refine.sh` 或任何上游脚本。
- 上游 `AGENTS.md`、README、CONTRIBUTING、docs、hooks、commands、agent/persona、插件配置或 marketplace 文件。
- 上游仓库其他非批准 Markdown、二进制、压缩包、设备文件、符号链接或隐藏文件。

### 同步与校验脚本

- 同步脚本固定为 `scripts/sync_loop_workflow_skills.js`。
- 校验脚本固定为 `scripts/validate_loop_workflow_skills.js`。
- 同步模式必须显式传入 `--source <上游仓库根>`，只用于开发期更新；不联网，不自行 clone/pull，不在插件运行时调用。
- `sync_loop_workflow_skills.js --check` 和 `validate_loop_workflow_skills.js` 只能读取仓库内快照，不依赖外部绝对路径，供 CI/发布前校验。
- 同步必须对输入使用 `lstat`，拒绝符号链接/特殊文件，写入 staging，全部校验通过后原子替换目标；失败保留旧快照。
- validator 必须证明 manifest 与磁盘一一对应、无重复 ID/路径、hash/bytes 一致、supportFiles 存在且不越界、无未索引 Markdown、无符号链接/特殊文件、无超限文件。
- 运行时只读已打包资源，不访问外部源、不联网、不回退扫描工作区或用户 Home 下同名 skill。

## 冻结 manifest schema

`manifest.json` 的最小 schema 固定如下，后续不得拆成官方 catalog 或多套互相漂移的索引：

```ts
type LoopWorkflowSkillManifest = {
  schemaVersion: number;
  source: {
    name: string;
    url: string;
    version: string;
    license: string;
    snapshotSha256: string;
  };
  files: Array<{
    path: string;
    bytes: number;
    sha256: string;
  }>;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    path: string;
    bytes: number;
    sha256: string;
    supportFiles: string[];
    developmentOnly: true;
    phases: Array<"meta" | "define" | "plan" | "build" | "verify" | "review" | "ship">;
    taskKinds: Array<
      | "architecture"
      | "planning"
      | "api"
      | "ui"
      | "implementation"
      | "refactor"
      | "migration"
      | "test"
      | "debug"
      | "review"
      | "security"
      | "performance"
      | "documentation"
      | "ci"
      | "observability"
      | "git"
      | "release"
    >;
    roles: Array<"main" | "subtask">;
    requiredCapabilities: string[];
    priority: number;
    positiveTriggers: string[];
    negativeTriggers: string[];
  }>;
};
```

字段规则：

- `schemaVersion` 首版为正整数；未知版本使整个 pack 不可用并安全降级，不做宽松猜测。
- `source.snapshotSha256` 是按 `files` 的 `path ASC` 顺序，对批准 payload 的 `path/bytes/sha256` 规范化清单计算的快照 hash。
- `files` 覆盖 `THIRD_PARTY_LICENSE.md`、全部 skill/support/reference Markdown；`manifest.json` 自身通过 JSON schema 和目录闭包校验，不做递归自哈希。
- `id` 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，唯一，且与 `skills/<id>` 目录一致。
- 所有 `path`/`supportFiles` 都是相对 `media/loop-workflow-skills/` 的 `/` 分隔路径；拒绝空值、绝对路径、反斜杠、drive/UNC、`.`/`..`、重复规范化路径。
- `path` 固定指向该 skill 的入口 `skills/<id>/SKILL.md`；模型永远看不到或返回该字段。
- `bytes/sha256` 必须与入口文件一致；`files` 负责全包逐文件完整性。
- `supportFiles` 只记录依赖闭包并做完整性校验；首版不递归拼入子任务 prompt。
- `developmentOnly` 对全部 24 项固定为 `true`。
- `priority` 为安全整数，数值越小优先级越高；相同优先级按 `id ASC`。
- `positiveTriggers/negativeTriggers` 只用于 compact metadata 和宿主门禁，不可包含路径或可执行命令。
- manifest 中 description 必须不超过 240 个 JavaScript 字符单元；超限由同步/校验阶段失败，不在运行时截断。

模型可见 compact metadata 仅包含：`id/name/description/phases/taskKinds/roles/requiredCapabilities/priority/positiveTriggers/negativeTriggers`。模型不可见 `path/supportFiles/bytes/sha256/source`，也没有路径控制权。

## 冻结运行时契约

```ts
type LobsterTaskRecord = {
  taskKind?: "development" | "non_development";
  // existing fields...
};

type LobsterSubtaskDecision = {
  id?: string;
  title: string;
  prompt: string;
  conflictGroup?: string;
  writeFiles?: string[];
  skillIds?: string[];
};

type LobsterSubtaskRecord = {
  // existing fields...
  skillIds?: string[];
  skillGuidance?: string;
};
```

信任和持久化规则：

- `taskKind` 是任务级可选字段，由宿主根门禁生成/持久化；主模型不能通过子任务 JSON 改写它。
- `skillIds` 是子任务决策唯一新增的模型可选字段。
- `normalizeSingleLobsterSubtaskDecision` 只接受字符串 ID 数组；模型返回的 `skillGuidance`、path、CLI、model、command 或未知字段全部忽略。
- `applyLobsterMainDecisionForRun` 在写 Store 前读取当前任务、可信 manifest 和本轮候选 allowlist，对每个子任务执行精门禁并生成最终快照。
- `LobsterSubtaskRecord.skillIds` 只保存宿主确认后的稳定、去重、排序 ID。
- `LobsterSubtaskRecord.skillGuidance` 只保存宿主从已校验资源生成的有界正文快照；不保存模型原文。
- `upsertLobsterSubtask` 和 `normalizeLobsterSubtaskRecord` 必须保留这两个可选字段；旧记录缺失字段时保持 `undefined`。
- 自动重试优先使用已持久化快照，不重新选择或重新读包生成不同正文。
- 手动继续发生在已有子会话，不重复拼接 guidance；完成/summary/communicationFile 更新不得丢失快照。

以下情况全部等价于“不注入并继续原 Loop”：

- 缺失 `taskKind`、旧任务记录或 `taskKind="non_development"`。
- 根任务或子任务分类不确定。
- 主模型没有返回 `skillIds`、返回空数组、未知 ID、非法类型或角色/阶段/能力不兼容。
- manifest schema 未知、重复 ID/路径、资源缺失、hash/bytes 不符、路径越界、符号链接逃逸或超预算。
- 插件升级后历史 ID 已移除且记录中没有可用的已持久化 guidance。

任何降级都不得把任务置为 `needs-review`，不得扫描替代路径，不得改变 CLI/model、`writeFiles`、并发分组、重试、沟通文件或主任务唤醒。

## 冻结双层门禁、阶段、角色与能力

### 根任务粗门禁

根门禁在构造普通主任务 prompt 或红蓝首轮 brief 前运行，只使用宿主可信输入：

- 用户原始 `displayPrompt`。
- `contextTags` 的文件/选择类型。
- 已知 workspace 文件扩展名或仓库内路径信号。

长期记忆文本、模型生成内容、skill Markdown 和模型返回 ID 不能作为开发任务证据。

强开发信号包括规划/架构/API、实现/重构/迁移、测试/build/compile/lint、bug/堆栈/debug、review/安全/性能、代码/配置/测试/架构文档路径。明确非开发信号包括翻译、纯摘要、普通文案、旅行/购物、闲聊和与软件交付无关的信息整理。

- 强证据为开发：持久化 `taskKind="development"`，向普通主任务和红蓝 brief 提供同一份有界 compact catalog。
- 明确非开发：持久化 `taskKind="non_development"`，普通主任务和红蓝 brief 不出现 catalog/选择协议附加段。
- 不确定：按不注入处理；不得为了启用能力猜测为开发。
- 非开发/不确定时，主任务 prompt、红蓝 brief 和后续子任务 model prompt 必须与修改前基线逐字相等；字符串测试固定无额外 skill 段。

### 子任务精门禁

中央宿主校验对每个子任务独立使用 `title + prompt + writeFiles + conflictGroup` 推断生命周期 phase 和 taskKinds，然后按以下顺序过滤模型 ID：

1. 根任务必须是 `development`，子任务也必须有强开发证据。
2. ID 必须属于本轮发给主模型的候选 allowlist。
3. metadata 必须 `developmentOnly=true`。
4. `phases` 与子任务阶段至少一项兼容。
5. `taskKinds` 与子任务意图至少一项兼容。
6. `roles` 必须包含 `subtask`。
7. `requiredCapabilities` 必须全部由宿主显式声明；没有声明等价于不可用。
8. 资源路径、类型、hash、bytes、内容清洗和预算必须通过。

宿主不得把被拒绝的 ID 静默替换成另一个 skill；无合法项就不注入，保留主模型的语义责任和安全降级。

### 特殊角色与能力

- `doubt-driven-development`：`roles=["main"]`，不得写入普通子任务的最终 `skillIds/skillGuidance`；首版不扩展为嵌套 reviewer 编排。
- `interview-me`、`idea-refine`：`roles=["main"]` 且 `requiredCapabilities=["interactive-user"]`；只允许交互主会话在分派前使用，非交互 Loop 子任务不可选。
- `browser-testing-with-devtools`：允许 `subtask`，但 `requiredCapabilities=["chrome-devtools-mcp"]`；宿主没有显式能力声明时跳过，不假装完成浏览器验证。
- `git-workflow-and-versioning`、`incremental-implementation`：即使被选中，也不能覆盖“不得自行 commit/branch/push”的当前任务规则。
- `planning-and-task-breakdown`、`spec-driven-development`：不得创建上游默认 `tasks/*` 计划替代 `.ch/docs/exec-plans/active/*`。
- `test-driven-development`：不得让普通子任务自行派发嵌套子任务。
- `frontend-ui-engineering`：必须继续服从项目主题语义值和禁止硬编码颜色规则。

## 冻结预算、排序与内容清洗

### 候选 catalog 预算

- 候选最多 32 项；当前快照 24 项全部可容纳，未来超出时按稳定排序取有界集合。
- 单个 `description` 最多 240 个 JavaScript 字符单元，超限 manifest 无效。
- 渲染给主模型的候选目录总长度最多 12,000 个 JavaScript 字符单元。
- 候选按 `priority ASC, id ASC` 排序；每个 metadata 条目作为整体加入，达到 32 项或 12,000 上限后停止，不截断条目中间内容。

### 子任务选择与 guidance 预算

- 每个子任务最多接受 3 个 ID。
- ID trim、去重、allowlist/门禁过滤后，按 `priority ASC, id ASC` 排序，再取前 3 个。
- 单个清洗后 guidance 最多 24,000 个 JavaScript 字符单元；超过则整篇跳过。
- 单个子任务全部 guidance（含固定分隔和来源标题）最多 32,000 个 JavaScript 字符单元。
- 按稳定顺序逐篇加入；若下一整篇会超过总预算，则该篇及后续项全部跳过，不在规则中间截断，也不让低优先级项越过高优先级项。
- 资源单文件上限 64 KiB；`media/loop-workflow-skills/` 完整快照上限 1 MiB。两者按文件 bytes 计算并由 sync/validator 强制。

### 内容清洗与 prompt 位置

宿主读取入口 Markdown 后必须：

- 去 UTF-8 BOM，统一 LF，拒绝非法 UTF-8/NUL。
- 严格解析并移除 YAML frontmatter，只注入正文。
- 移除除换行/Tab 外的 C0 控制字符，trim 行尾和首尾空白。
- 不做模板插值，不递归读取任意链接，不执行 Markdown 中命令。
- 验证正文不包含宿主 delimiter，或使用稳定转义；同一 ID 只出现一次。
- 不把正文写入日志、shell command、文件路径、JSON key 或 Webview `innerHTML`。

注入位置固定在 `buildLobsterSubtaskModelPrompt` 的“子任务职责”之后、“当前子任务”之前。每段使用稳定来源 ID 分隔；skill block 后再次声明系统/用户、AGENTS、当前职责、`writeFiles`、验收和沟通文件要求优先。`buildLobsterSubtaskDisplayPrompt` 不包含正文。

## 决策记录与替代项

- 2026-07-12：采用 `media/loop-workflow-skills/` 单一内部资源根；拒绝 `.agents/skills`、workspace scaffold 和官方 catalog，因为三者会扩大用户可见/安装语义并产生漂移。
- 2026-07-12：采用“24 个 skill 目录内完整 Markdown + 7 个根 reference + 第三方许可 + 单 manifest”的批准闭包；拒绝只复制 `SKILL.md`，因为会丢 3 个 `idea-refine` 附属 Markdown 和 7 个根 reference；拒绝复制完整上游仓库，因为会带入无关规则、脚本和插件配置。
- 2026-07-12：精确上游 commit 未知不阻塞首版；不伪造 provenance，使用声明版本、来源 URL、许可和批准 payload 的逐文件/hash 快照。
- 2026-07-12：采用主模型返回 `skillIds`、宿主中央校验并生成 `skillGuidance`；拒绝模型返回路径/正文，拒绝宿主无提示地替换成另一 skill。
- 2026-07-12：任务级只新增宿主 `taskKind`；子任务决策只新增 `skillIds`；Store 只新增宿主确认的 `skillIds/skillGuidance`。不新增 phase/path/hash/CLI/model/command 等模型控制字段。
- 2026-07-12：选择快照写入 Store，接受有界记录增长，以换取自动重试和资源升级后的稳定 prompt；每个子任务总 guidance 仍受 32,000 字符硬上限。
- 2026-07-12：根粗门禁 + 子任务精门禁同时存在；unknown 安全默认不注入。仅任务级门禁不能处理同批次不同阶段，故否决。
- 2026-07-12：supportFiles 保留和校验但首版不自动注入；避免递归扩张 prompt。若未来需要 support 内容，必须另行扩展 schema/预算并更新本计划或新建 ADR。
- 2026-07-12：首版无 UI，不新增 i18n；资源损坏只做内部诊断并 legacy 降级。
- 2026-07-12：不修改 `package.json` 增加命令；直接运行两个固定 Node 脚本，避免与当前并发版本号改动混杂。
- 2026-07-12：主任务复核批准 2B 增加 `src/lobsterDebateRunner.ts` 最小 seam。原因是 consensus prompt 在 runner 内构造；runner 只增加末尾可选 catalog 参数并原样透传，不改变参与者、裁判、模型、会话或 artifact 逻辑。

## 依赖图与实施顺序

```text
阶段 1 三份审计（completed）
    -> 本计划冻结契约（当前任务）
        -> 实施批次 1（3 个互不重叠任务，可并行）
            A. 资源快照 + sync/validator
            B. lobsterSkillGuidance 纯模块 + 单测
            C. lobsterTaskStore 可选字段 + 兼容单测
        -> 批次 1 合并检查点
            -> 实施批次 2（按 2A -> 2B 串行）
                2A. 红蓝 brief/consensus 协议
                2B. extension 普通主任务/中央校验/子任务 prompt
            -> 批次 2 合并检查点
                -> 实施批次 3
                    文档同步
                    -> 完整测试/构建/VSIX 核验
                    -> 五轴复核与计划归档
```

不得跨过依赖：资源契约未落地前不得把外部路径接入运行时；Store 字段未 round-trip 前不得接 prompt；红蓝首轮合约未覆盖前不得宣称完成；实际 VSIX 未解包核验前不得归档。

## 后续批次与精确 writeFiles

### 实施批次 1：可并行基础任务

#### 任务 1A：导入资源快照并实现同步/校验

- writeFiles：
  - `media/loop-workflow-skills/**`
  - `scripts/sync_loop_workflow_skills.js`
  - `scripts/validate_loop_workflow_skills.js`
- 禁止触碰：`package.json`、`.vscodeignore`、`.agents/skills/**`、`media/workspace-scaffold/**`、`media/official_skills_catalog.json`、`media/official-skills/**`、`src/**`。
- 验收：批准闭包、许可、manifest、逐文件/hash、64 KiB/1 MiB、路径/symlink/UTF-8/隐藏文件校验全部通过；重复同步无 diff；`--check` 不依赖外部源。
- 定向验证：

```bash
node scripts/sync_loop_workflow_skills.js --source /Users/fangjiawei/work/agent-skills
node scripts/sync_loop_workflow_skills.js --check
node scripts/validate_loop_workflow_skills.js
git diff --check -- media/loop-workflow-skills scripts/sync_loop_workflow_skills.js scripts/validate_loop_workflow_skills.js
```

#### 任务 1B：实现 `lobsterSkillGuidance` 纯模块

- writeFiles：
  - `src/lobsterSkillGuidance.ts`
  - `src/test/lobsterSkillGuidance.test.ts`
- 禁止触碰：资源包、Store、`src/extension.ts`、`src/lobsterPromptBuilders.ts`、官方 catalog/scaffold。
- 模块职责：资源根解析、manifest 严格解析、粗/精门禁纯函数、阶段/task kind/角色/能力过滤、allowlist、路径 containment/realpath、hash/bytes、清洗、排序、预算、compact catalog 和 guidance section 构建。
- 测试使用临时目录/fixture，不写共享资源，保证可与 1A 并行。
- 验收：开发/非开发/unknown、非法 ID/路径/symlink/hash、特殊角色/能力、稳定排序、3/24k/32k/32/240/12k 预算、整篇跳过和无 guidance 等价均有表驱动测试。
- 定向验证：

```bash
npm run build
node --test dist/test/lobsterSkillGuidance.test.js
```

#### 任务 1C：扩展任务记录可选字段

- writeFiles：
  - `src/lobsterTaskStore.ts`
  - `src/test/lobsterTaskStore.test.ts`
- 禁止触碰：资源包、纯模块、`src/extension.ts`、`src/lobsterPromptBuilders.ts`、官方 catalog/scaffold。
- 变更：`LobsterTaskRecord.taskKind?`、`LobsterSubtaskRecord.skillIds?`、`skillGuidance?`；所有字段可选并集中 normalize。
- 验收：旧记录无字段可读写；错误类型归一化为空；新字段 round-trip；完成/重试/status/summary/communicationFile 更新不丢字段；未知模型字段不被持久化。
- 定向验证：

```bash
npm run build
node --test dist/test/lobsterTaskStore.test.js
```

#### 批次 1 合并检查点

- [x] 三个任务的 `git diff --name-only` 无 writeFiles 交集。
- [x] `node scripts/validate_loop_workflow_skills.js` 通过。
- [x] 两个新增 Node 测试通过，`npm run build` 通过。
- [x] 非开发/旧记录仍无任何 prompt 接线变化。

### 实施批次 2：运行链路接线

#### 任务 2A：覆盖红蓝首轮 brief 与 consensus 合约

- 依赖：批次 1 合并检查点。
- writeFiles：
  - `src/lobsterPromptBuilders.ts`
  - `src/test/lobsterPromptBuilders.test.ts`
  - `src/test/lobsterDebate.test.ts`
- 禁止触碰：`src/extension.ts`、Store、资源、官方 catalog/scaffold。
- 变更：`buildLobsterDebateBriefMarkdown` 接收可选 compact catalog section；`buildLobsterDebateConsensusModelPrompt` 的子任务 JSON 合约允许可选 `skillIds`；非开发/无 catalog 参数时输出保持旧基线。
- 验收：红蓝首轮看到与普通主任务同源有界 catalog；只允许 ID；旧 `decision.json` 无 `skillIds` 兼容；非开发 brief 无 catalog；main-only/interactive-only metadata 明示角色限制。
- 定向验证：

```bash
npm run build
node --test dist/test/lobsterPromptBuilders.test.js dist/test/lobsterDebate.test.js
```

#### 任务 2B：接入普通主任务、中央校验与子任务 prompt

- 依赖：任务 2A 完成。
- writeFiles：
  - `src/extension.ts`
  - `src/lobsterDebateRunner.ts`
  - `src/test/lobsterSkillIntegration.test.ts`
  - `src/test/lobsterMainFailure.test.ts`
  - `src/test/loopPromptQueue.test.ts`
- 禁止触碰：`src/lobsterPromptBuilders.ts`、Store、资源、官方 catalog/scaffold。
- 变更：
  - 根门禁生成/保存 `taskKind`。
  - `buildLobsterMainModelPrompt` 仅在 development 时附加 compact catalog 和 `skillIds` 合约。
  - 红蓝首轮 brief 与 runner 内 consensus 调用接收同一个 catalog section；红蓝后续轮复用普通主任务目录。
  - `normalizeSingleLobsterSubtaskDecision` 只归一化 `skillIds`。
  - `applyLobsterMainDecisionForRun` 做中央精门禁并生成宿主快照。
  - `upsertLobsterSubtask` 持久化确认后的 `skillIds/skillGuidance`。
  - `buildLobsterSubtaskModelPrompt` 按冻结位置注入；display prompt 不注入。
  - 自动重试复用 Store 快照。
- 验收：普通主从、红蓝首轮/后续轮、并发子任务各自选择、非开发等价、旧协议、未知 ID、资源损坏、重试快照、CLI/model/writeFiles 不变均有集成证据。
- 定向验证：

```bash
npm run build
node --test \
  dist/test/lobsterSkillIntegration.test.js \
  dist/test/lobsterMainFailure.test.js \
  dist/test/loopPromptQueue.test.js \
  dist/test/lobsterParallel.test.js \
  dist/test/sessionMessageActions.test.js
```

#### 批次 2 合并检查点

- [x] development 完成“根门禁 -> compact catalog -> 模型 ID -> 中央精门禁 -> Store 快照 -> 子任务注入”闭环。
- [x] 普通主从和红蓝首轮/后续轮都覆盖。
- [x] non-development、unknown 和 legacy 无 catalog/正文，行为保持原 Loop。
- [x] 自动重试使用原快照；资源更新不改变已开始子任务的 guidance。
- [x] 本功能未修改 `src/lobsterParallel.ts`、CLI runner、UI/i18n；工作区中的相关并发改动不属于本批次。

2B 定向验证结果：

- RED：唯一临时输出目录全量编译退出码 `0`；新增集成/回归测试退出码 `1`，12 项新行为全部按预期失败，既有 14 项通过。
- GREEN：唯一临时输出目录全量编译退出码 `0`；27/27 项集成与最小回归通过。
- 最终：sync `--check`、严格 validator、`npm run build` 均退出码 `0`；9 组定向测试共 143 项全部通过；`git diff --check`、未跟踪文件 whitespace、受保护 Skills 目录和大小写碰撞检查通过。

### 实施批次 3：文档、完整验证、VSIX 与归档

#### 任务 3A：同步事实文档

- 依赖：批次 2 合并检查点。
- writeFiles：
  - `ARCHITECTURE.md`
  - `.ch/docs/design-docs/vscode-cli-extension-runtime.md`
  - `.ch/docs/references/cli-runtime-reference.md`
  - `.ch/docs/references/authoritative-skills.md`
  - `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
  - `.ch/docs/product-specs/FEATURE_INVENTORY.md`
  - `.ch/docs/SECURITY.md`
  - `.ch/docs/runbooks/local-development.md`
  - `.ch/docs/runbooks/PITFALLS.md`
  - `docs/cli-reference.md`
  - `docs/vscode_cli_plugin_dev_guide.md`
  - `docs/插件功能清单.md`
- 禁止触碰：代码、资源、`media/official_skills_catalog.json`、workspace scaffold、i18n。
- 验收：记录内部 pack 与官方/工作区 Skills 隔离、双层门禁、字段、预算、降级、重试快照、来源/许可、同步/校验/VSIX 命令；兼容入口只补导航；明确首版无 UI/i18n。
- 验证：Markdown/链接自查、代码常量对照、`git diff --check`。

#### 任务 3B：完整测试、构建和 VSIX 核验

- 依赖：任务 3A 完成。
- writeFiles：无；发现本功能缺陷时停止并回派到拥有对应文件的实施任务，不在验证任务扩大范围。
- 验证命令：

```bash
node scripts/sync_loop_workflow_skills.js --check
node scripts/validate_loop_workflow_skills.js
npm run build
node --test \
  dist/test/lobsterSkillGuidance.test.js \
  dist/test/lobsterTaskStore.test.js \
  dist/test/lobsterPromptBuilders.test.js \
  dist/test/lobsterSkillIntegration.test.js \
  dist/test/sessionMessageActions.test.js \
  dist/test/lobsterParallel.test.js \
  dist/test/lobsterDebate.test.js \
  dist/test/lobsterMainFailure.test.js \
  dist/test/loopPromptQueue.test.js \
  dist/test/officialSkillService.test.js \
  dist/test/officialSkillsVersioning.test.js \
  dist/test/longTermMemory.test.js
vsce ls --no-dependencies | rg '^media/loop-workflow-skills/'
./export_vscode_extension.sh
unzip -l dist/sinitek-cli-tools-*.vsix | rg 'extension/media/loop-workflow-skills/'
git diff --exit-code -- media/official_skills_catalog.json media/official-skills media/workspace-scaffold .agents/skills
git diff --check
```

- 核验必须把 manifest `files[].path` 与 `vsce ls`、实际 VSIX 解包清单逐项比对，不能只证明目录存在。
- 失败按实现缺陷、断言过期、fixture、环境、历史失败或范围外失败分类；不得为绿灯修改无关代码。

#### 任务 3C：五轴复核并归档

- 依赖：任务 3B 全部通过，或范围外失败已有基线证据与主任务批准。
- writeFiles：
  - `.ch/docs/exec-plans/active/2026-07-12-loop-subtask-skill-injection.md`
  - `.ch/docs/exec-plans/completed/2026-07-12-loop-subtask-skill-injection.md`
- 复核：正确性、可读性、架构、安全、性能；检查 diff 范围、资源来源、prompt/记录预算、日志、兼容、文档和 VSIX。
- 验收：Required 问题关闭；计划写入最终命令/结果并从 active 移到 completed。

## 验收标准

### 资源与完整性

- [x] `media/loop-workflow-skills/` 只包含冻结布局和批准闭包。
- [x] 24 个 skill、27 个 skill Markdown、7 个根 reference、许可和 manifest 的 inventory 可追溯。
- [x] MIT 版权/许可、来源 URL、声明版本、未知 commit 事实和 snapshot hash 已记录。
- [x] path/bytes/hash/supportFiles 一致；重复、断链、越界、symlink、非法 UTF-8、NUL、64 KiB/1 MiB 超限均失败。
- [x] `media/official_skills_catalog.json`、`media/official-skills/**`、`.agents/skills/**`、`media/workspace-scaffold/**` 无本功能 diff。

### 开发门禁与选择

- [x] 根任务只有强开发证据才获得 compact catalog；非开发和 unknown 不获得。
- [x] 普通主任务、红蓝首轮 brief/consensus、红蓝后续轮使用同一 manifest 派生目录。
- [x] 主模型只能返回每子任务最多 3 个 `skillIds`，不能返回路径或可信 guidance。
- [x] 精门禁按 `title/prompt/writeFiles/conflictGroup` 验证 phase、taskKinds、role、capability 和 allowlist。
- [x] main-only、interactive-only、Chrome DevTools 能力限制和禁止 commit/嵌套派发/writeFiles 扩张均生效。
- [x] 宿主不替换被拒 ID；无合法项时继续原 Loop。

### Prompt、预算与重试

- [x] 候选 32/240/12,000 和子任务 3/24,000/32,000 常量有边界测试。
- [x] 选择按 `priority ASC, id ASC` 去重排序；超预算整篇跳过，不截断规则中间内容。
- [x] 子任务 prompt 在冻结位置包含宿主快照、稳定 delimiter 和优先级重申；display prompt 不包含正文。
- [x] supportFiles 不自动递归注入；未选 skill 和完整 catalog 不进入子任务 prompt。
- [x] 自动重试复用已持久化 guidance；手动继续不重复拼接。
- [x] 日志、shell、路径、Webview HTML 不接收 skill 正文。

### 兼容与非开发补充要求

- [x] 旧记录无 `taskKind/skillIds/skillGuidance` 可读取、恢复、重试和完成。
- [x] 非开发普通主任务、红蓝 brief 和子任务 model prompt 没有 catalog/skill block，按原 Loop 直接安排。
- [x] 未知字段、未知 ID、损坏资源、未知 schema、预算超限和历史已移除 ID 都安全降级。
- [x] 新字段不改变 `activeSubtaskIds`、status、summary、communicationFile、并发、CLI/model、重试和主任务唤醒。
- [x] 普通 coding 模式不经过 Loop workflow skill 逻辑。

### 构建、打包、文档与质量

- [x] 固定 sync/validator、`npm run build`、相关 Node tests 全部通过，或范围外失败有基线证据。
- [x] `vsce ls --no-dependencies` 和实际 VSIX 解包逐项包含 manifest 全部 payload。
- [x] extension host 从安装根读取资源，cwd 指向其他目录也不影响。
- [x] 功能清单、能力规格、运行时设计/参考、来源、安全、runbook、真实 PITFALLS 和兼容入口已同步。
- [x] 首版无 UI/i18n 变更，`media/official_skills_catalog.json` 保持不变且 description 中文约束不被触发。
- [x] 五轴复核完成，计划记录最终结果并归档。

## 风险与缓解

| 风险 | 影响 | 冻结缓解 | 降级/回滚 |
| --- | --- | --- | --- |
| 精确上游 commit 不可验证 | 来源追溯不足 | 不伪造 commit；记录 URL/version/license 和批准 payload hash | 快照仍可精确审计；更新时重新生成 diff/hash |
| 反引号依赖漏包 | skill 语义残缺 | `supportFiles` + 无未索引 Markdown + 7 references 校验 | pack 无效，legacy Loop |
| 模型返回路径/伪造 guidance | 任意文件读取/提示绕过 | 决策只接受 ID；路径/正文仅由宿主生成 | 丢弃非法字段，legacy Loop |
| 非开发误注入 | 用户补充要求被破坏 | 根粗门禁 + 子任务精门禁 + unknown 默认关闭 | 不注入，原 Loop 继续 |
| 角色/能力不匹配 | 子任务执行不可用步骤 | roles/requiredCapabilities 双校验 | 拒绝该 ID，不替换 |
| prompt 膨胀 | 成本、延迟、上下文挤压 | 32/240/12k、3/24k/32k、整篇跳过 | 保留已纳入高优先级项或完全 legacy |
| Store normalize 剥离字段 | 重试/恢复丢失 guidance | Store round-trip 单测和 upsert 显式复制 | 无字段按旧路径运行 |
| 重试重新读取更新资源 | 同一子任务行为漂移 | 持久化 guidance 快照 | 复用旧快照；无快照则 legacy |
| 红蓝首轮漏接 | 部分执行模式无能力 | 单独修改 brief/consensus 并测试旧 decision | 不宣称完成，回派 2A |
| VSIX 漏包或从 cwd 解析 | 发布态功能失效 | extension root + `vsce ls` + 实际解包逐项比对 | loader 诊断并 legacy |
| 与官方/scaffold 混淆 | 用户目录污染/版本漂移 | 独立根、禁止 diff、官方测试 | 停止合并并移除错误接线 |
| 并发写共享文件 | 覆盖或半成品 | 批次 1 精确不重叠；批次 2 串行 | 停止并由主任务重排 |

## 最终验证与发布证据

### Round 10：关闭 round 9 两个 Required

- RED：`npm run build` 退出码 `0`；三个针对性测试文件共 `76 tests / 71 pass / 5 fail`，5 项失败分别覆盖“明确非开发意图 + 技术路径”、direct fresh upsert、共享中央 apply 无选择、非法/未知等无快照结果和 Store 半快照。
- GREEN：`npm run build` 退出码 `0`；针对性测试 `76/76 pass`；相邻回归 `73/73 pass`。
- 根因修复：明确非开发意图先于技术路径；fresh 同 ID 决策没有合法宿主快照时同时删除 `skillIds/skillGuidance`；Store 只成对保留两个字段；自动 retry 不经过 fresh upsert，继续逐字复用首次快照。

### Round 11：最终 fresh 3B、VSIX 与 ZIP 审计

- `node scripts/sync_loop_workflow_skills.js --check`、`node scripts/validate_loop_workflow_skills.js`、fresh `npm run build`、计划指定 12 个测试文件、VSCE 集合比较、VSIX 导出、`unzip -t`、VSIX 审计、受保护路径检查和 `git diff --check` 均为 exit `0`。
- 12 个测试文件汇总：`165 tests / 165 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo`。
- repository、manifest、VSCE、VSIX 和实际解包树的 pack 集合均为 `36/36`；manifest 自身加 35 个 payload，无缺失或额外文件。
- 35 个 payload 共 `380502 bytes`，repository、manifest、VSIX 与解包树的 bytes/SHA-256 四方一致；inventory 为 24 个 Skill、27 个 Skill Markdown、7 个根 reference。
- ZIP 共 1505 个 regular-file entry；无路径逃逸、重复条目、symlink、特殊文件或 CRC 错误。
- 唯一制品：`dist/sinitek-cli-tools-0.17.0.vsix`，`71216425 bytes`，SHA-256 `3ca8e4e2cf2b1fe6c7cb80adf27cf10c133f8e468ba0fb733a92adbb134cacc3`。

### Round 12：证据新鲜度与五轴终审

- `key-evidence.sha256` 自身 SHA-256 为 `04683e5b55ee71b4f74eb93b85d4a9eb71863481d612e606454fa7186fd0650d`，逐项校验全部 `OK`。
- round 11 后相关实现、测试、脚本、pack、package/打包配置共 273 项，聚合 SHA-256 仍为 `e7e0f6d6556578f44bc17f51ff479f386747e6519d8de7acd6e38653fbb358f5`；受保护路径 430 项聚合仍为 `4e8d31aef591003f4d481c9468d6e912285f7fbf9c7bf87fd11759c61c5d36cf`。
- 归档前能力规格为 `52399 bytes`、SHA-256 `7bc58968a68cd8f7156f25d6da39f7fb5e13bb18fa5783c186365be861ae450a`；功能清单为 `25957 bytes`、SHA-256 `4c3ae0de834bd5fc861690b912cda211c4749c4e416ca8876fbf657030d8814b`；active 计划输入基线为 `46033 bytes`、SHA-256 `043d20b88827a083ae1305680b8126ca045699c40da1f07ccd2ade5cd1c98f32`。
- 五轴 verdict：correctness PASS；readability/simplicity PASS with Suggestions；architecture PASS with Suggestions；security PASS；performance PASS with Suggestions。
- 严重度计数：**Blocker 0 / Required 0 / Suggestion 4 / Nit 0**。

保留的非阻塞 Suggestions：

1. 给模型返回的 raw Skill ID 数量和单轮诊断数量增加显式上限及聚合 overflow 诊断。
2. 按 extension root/manifest 指纹缓存静态已校验 pack 的成功或失败结果，减少每个 development 主轮重复读取 35 个 payload 的 I/O。
3. 后续在不改变行为的前提下拆分 `src/lobsterSkillGuidance.ts` 或共享 Store/loader 的冻结边界常量，降低规则漂移风险。
4. 另立发布优化任务处理约 71.2 MB、1505 个 ZIP regular-file entry 的既有 VSIX 体量；该项不影响本功能正确性、完整性或本次归档。

## 文档同步检查表

- [x] `ARCHITECTURE.md`：内部 workflow asset/module 与官方 Skills 服务分层。
- [x] `.ch/docs/design-docs/vscode-cli-extension-runtime.md`：manifest、双层门禁、普通/红蓝选择、中央校验、Store 快照和注入链路。
- [x] `.ch/docs/references/cli-runtime-reference.md`：字段、恢复/重试、非开发和错误降级事实。
- [x] `.ch/docs/references/authoritative-skills.md`：Addy Osmani `agent-skills`、MIT、version/hash 和未知 commit。
- [x] `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`：用户可感知能力和首版边界。
- [x] `.ch/docs/product-specs/FEATURE_INVENTORY.md`：新增 Loop 开发任务增强项与真实验证命令。
- [x] `.ch/docs/SECURITY.md`：静态供应链、路径/hash/大小、prompt 信任边界。
- [x] `.ch/docs/runbooks/local-development.md`：sync/check/build/test/VSIX 命令。
- [x] `.ch/docs/runbooks/PITFALLS.md`：`.agents/skills` 自动发现、scaffold 不覆盖漂移、只复制 skills 漏 references、红蓝首轮绕过普通 prompt、Store normalize 剥离未知字段。
- [x] `docs/cli-reference.md`、`docs/vscode_cli_plugin_dev_guide.md`、`docs/插件功能清单.md`：只保持导航和简短口径。
- [x] 无 UI/i18n 文件变更；`media/official_skills_catalog.json` 不修改。

## 实现验证问题关闭情况

1. 已关闭：`source.snapshotSha256` 为 `2603c030a1ded0bcad531ce189b81d83bef67054ebaa6855e254ff100922bcf8`；35 个 payload 的逐文件 bytes/hash、重复校验和 sync `--check` 均稳定。
2. 已关闭：manifest、VSCE、VSIX 和实际解包树均为 `36/36`，35 个 payload 四方 bytes/hash 一致；生产 loader 固定使用 `extensionUri.fsPath/media/loop-workflow-skills`，无 cwd/Home/workspace 回退。
3. 已关闭：普通主从、红蓝首轮 brief/consensus、红蓝后续主持人、共享中央 apply、fresh replacement、自动 retry、旧记录和失败降级均有定向及集成回归。
4. 已关闭：中英文开发正向矩阵与摘要、资料整理、普通问答、解释、翻译、写作、购物、旅行等明确非开发矩阵均已覆盖；技术路径不能覆盖明确非开发意图，unknown 继续默认关闭。

## 当前结论

实施批次 1A/1B/1C、2A/2B、3A/3B/3C 全部完成。最终实现满足“仅开发级 Loop 可选择高级 Skill、明确非开发任务继续原 Loop”的核心边界；普通/红蓝共享同源 compact catalog 和中央校验，模型只返回 ID，宿主生成并成对持久化快照，fresh 决策 fail-closed，自动 retry 精确复用，资源固定从安装根加载。round 12 独立五轴复核结论为 **Blocker 0 / Required 0**，批准将本计划从 active 完整移动到 completed；保留 4 项非阻塞 Suggestion 作为后续独立优化，不影响当前交付。
