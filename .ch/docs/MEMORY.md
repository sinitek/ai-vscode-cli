---
doc_type: memory_rules
scope: global
status: active
last_verified_at: 2026-05-21
source_of_truth: .ch/docs/MEMORY.md
derived_from:
  - .ch/docs/memory/README.md
supersedes: []
related_paths:
  - .ch/docs/memory/
  - .agents/skills/
---

# 记忆流转规则

这个文件定义：**信息第一次出现时写到哪里，什么时候上提，什么时候清理。**

目标不是制造更多文档，而是让仓库里的知识能稳定流转，不长期卡在聊天、计划或零散笔记里。

## 1. 四层记忆

当前框架保持 `Markdown + skills` 为核心，按下面四层管理信息：

| 层级 | 含义 | 主要载体 |
| --- | --- | --- |
| Working | 当前任务正在使用的信息 | `exec-plans/active/`、当前任务列表、局部 handoff |
| Episodic | 一次会话或一个阶段发生了什么 | `.ch/docs/handoffs/`、阶段总结、已完成计划结论 |
| Semantic | 稳定规则、长期结论、可反复复用的事实 | `memory/` 热区、`design-docs/`、`FEATURE_INVENTORY.md` |
| Procedural | 重复执行的方法、排障套路、可程序化步骤 | `skills/`、`runbooks/`、checklists、`python3` 脚本 |

## 1.1 记忆金字塔

为了让 recall 更准、热区更省，任务收尾时还要按下面的“记忆金字塔”检查是否需要压缩、抽取或上提：

| 层级 | 目标 | 主要载体 | 收尾判断 |
| --- | --- | --- | --- |
| L1 滚动摘要 | 把较旧、分散、但仍有跨会话价值的 working / episodic 信息压缩成短摘要 | `memory/ROLLING_SUMMARY.md` | 旧 handoff / active plan 是否可以合并成一段摘要，并减少后续读取原文的必要 |
| L2 事件记忆 | 从摘要、handoff、plan、runbook 中抽取重要事件 | `memory/EVENT_MEMORY.md` | 是否出现“失败原因”“成功方案”“迁移/回滚/事故/关键决策”等以后会影响判断的节点 |
| L3 用户/项目画像 | 保留长期稳定的用户偏好、项目事实、技术栈与业务约束 | `memory/USER_PREFERENCES.md`、`memory/PROJECT_CONTEXT.md` | 某条信息是否已经稳定到下次任务默认要先知道 |
| L4 程序性经验 | 保留可复用规则、固定操作流、排障套路和可程序化步骤 | `memory/LESSONS_LEARNED.md`、`runbooks/`、`skills/` | 某条经验是否已经能转成“以后每次怎么做” |

金字塔不是新增事实来源层级，而是热区记忆的压缩与上提规则。越往上越稳定、越可复用；越往下越接近近期上下文。收尾时优先删除重复内容：一条信息上提到 L3/L4 后，L1/L2 只保留短链接或直接清理。

## 2. 默认写入规则

### 2.1 当前任务事实

下面这些内容，默认先进入 `exec-plans/active/`：

- 当前目标
- 范围与非目标
- 风险与验证计划
- 阶段进展
- 本轮没有完成但确定要继续的事项

不要一开始就把这些内容写进长期热区。

如果本轮任务会跨会话继续，收尾前应额外生成 `.ch/docs/handoffs/` 下的 handoff 文档。

### 2.2 跨会话仍要先读的信息

下面这些内容，应该进入 `memory/` 热区：

- 较旧任务脉络的压缩摘要
- 会影响以后判断的重要事件
- 后续多轮任务都需要先知道的项目上下文
- 用户明确表达过、希望长期保持的偏好
- 当前仍开放的承诺和待办
- 当前仍有效的风险
- 已验证、但暂时还不值得扩展成完整设计文档或 runbook 的经验

热区只保留短而关键的入口信息，不承载长篇背景。

### 2.3 稳定设计结论

如果某条结论回答的是“为什么这样设计”，并且满足下面任一条件，应从计划或热区上提到 `design-docs/`：

- 影响多个目录或模块
- 涉及分层边界、依赖方向、数据流、权限模型
- 以后很可能被继续引用

一旦设计文档成为事实来源，热区里只保留指向，不重复长段内容。

### 2.4 用户可见行为和能力范围

如果变化会影响功能、行为、权限、流程、角色或验收，必须进入：

- `product-specs/`
- `FEATURE_INVENTORY.md`

不要把用户可见能力只留在计划或热区里。

### 2.5 复发问题和长期规避动作

如果某个问题已经确认会复发，且以后需要靠固定动作规避，应进入：

- `runbooks/PITFALLS.md` 及其子文件
- 对应专题 runbook

如果它还只是当前阶段的观察风险，先留在 `ACTIVE_RISKS.md`；一旦形成稳定规避法，再迁入 runbook。

### 2.6 重复执行的方法

如果某类动作会一再出现，并且存在明显机械化步骤，应进入：

- `skills/`
- 必要时由 skill 调用 `python3` 脚本

适合程序化的内容包括：

- 结构化提取
- 索引生成
- 上提候选检查
- 格式校验
- freshness 检查
- handoff 初稿生成

脚本是为提高效率和准确率服务的；最终产物仍应回写为可审阅的 Markdown。

### 2.7 滚动摘要和事件记忆

当旧计划、旧 handoff 或阶段性结论仍有价值，但直接读取原文成本过高时，先压缩到 `ROLLING_SUMMARY.md`。

当压缩摘要中出现以后需要单独召回的节点，再抽取到 `EVENT_MEMORY.md`。典型事件包括：

- 某次失败的明确原因
- 某次成功的可复用方案
- 关键迁移、回滚、事故复盘
- 会改变后续实现判断的用户或项目决策

如果事件已经沉淀成稳定规则，应继续迁入 `PROJECT_CONTEXT.md`、`USER_PREFERENCES.md`、`runbooks/` 或 `skills/`，避免 L2 长期堆积。

## 3. 上提触发条件

满足下面任一条件，就不该继续只留在 working 层：

1. 下一次会话仍然需要优先知道
2. 该结论已经被两个以上任务复用
3. 它已经影响用户可见行为或验收
4. 它已经形成稳定操作法
5. 它已经成为复发风险或长期坑点

## 3.1 长期记忆文档 front matter

热区记忆文档默认应带统一 front matter，至少包含下面字段：

```yaml
---
memory_type: rolling_summary | event_memory | project_context | user_preferences | pending_items | lesson | active_risk
scope: global | project | module
status: active | superseded | archived
last_verified_at: YYYY-MM-DD
source_of_truth: path-or-owner
derived_from:
  - .ch/docs/exec-plans/active/...
supersedes: []
related_paths: []
---
```

规则：

- `memory_type` 用来标识这份记忆文档承载的语义。
- `status` 不是可选装饰；一旦文档失效或被替代，应明确标成 `superseded` 或 `archived`。
- `last_verified_at` 用来支撑 freshness 检查。
- `source_of_truth` 必须指向真正负责这类事实的文档或归属。
- `derived_from`、`supersedes`、`related_paths` 可以先为空，但字段应保留，便于后续机械处理。

## 3.2 隐私与禁止入记忆

如果某段内容只允许当前会话使用，不允许进入长期记忆、generated 索引、reference pack 或跨仓材料，应使用隐私标签包裹：

```xml
<private>
这里放只给当前会话看的内容。
</private>
```

同样会被 generated 脚本剥离的标签包括：

- `<private>...</private>`
- `<no-memory>...</no-memory>`
- `<memory-private>...</memory-private>`
- `<system_instruction>...</system_instruction>`
- `<system-instruction>...</system-instruction>`
- `<system-reminder>...</system-reminder>`
- `<persisted-output>...</persisted-output>`

规则：

- 标签内内容不会进入 `memory-indexer` 生成的 recall index、observation registry、timeline 或 topic corpus。
- `reference-pack` 导出时同样会跳过 private 文档，并剥离 private 标签块。
- 如果整份文档不应进入记忆索引，可在 front matter 中写 `memory_visibility: private` 或 `private: true`。
- 隐私标签不是密钥管理方案；密钥、令牌、生产地址、客户数据仍不应写入仓库。
- 如果某条记忆的来源包含被剥离的隐私段，应保留非敏感摘要和事实来源，不要把敏感内容改写进摘要。

## 3.3 ID 化 observation registry

`memory-indexer` 会把热区文档、active plans、pending items、active risks 和 lessons 转成 generated-only 的 observation entries。

每条 entry 至少包含：

- `id`：稳定的 `mem-<hash>` 形式，用于 recall 和 timeline anchor
- `type`：`risk`、`pending`、`event`、`lesson`、`context`、`preference`、`plan`、`summary`、`rule` 等
- `title` / `facts` / `narrative`
- `concepts` / `topic`
- `source_path` / `source_kind`
- `read_tokens`
- `content_hash`

这些条目的事实来源仍是原始 Markdown；registry 只是低成本召回面，不是新的长期事实来源。

## 3.4 Claim-aware index 的最小规则

如果记忆索引已经支持 `MemoryClaimLite`，它只承担“把 observation 进一步拆成可检查、可降级、可复核的轻量 claim”这一个职责，不引入新的长期事实来源。

每条 claim-lite 至少应包含：

- `claim_id`
- `text`
- `claim_type`
- `status`：至少支持 `active`、`needs_verification`、`superseded`、`archived`
- `source_path`
- `source_observation_id`
- `content_hash`
- `source_span` 或 `source_anchor`
- `review_after`

规则：

- claim-lite 必须 claim-aware，但仍然 source-first；没有来源锚点的 claim 不应作为稳定输入长期存在。
- `needs_verification`、`superseded`、`archived` 的 claim 可以保留在 generated 索引中，但不应继续被默认视作高优先 recall 输入。
- claim-lite 用于帮助 recall、eval、freshness 和治理，不直接替代 `memory/`、`design-docs/`、`runbooks/` 或 `product-specs/`。
- 第一阶段只要求最小字段和可审阅证据，不要求三元组、本体、图数据库或外部语义服务。

## 3.5 Timeline 与 topic corpus

`memory-indexer` 还会生成：

- `timeline.md`：按时间和来源排列 observation entries
- `topic-corpus.md`：按 topic 聚合可复用知识

使用规则：

- 需要围绕某条记忆恢复前后文时，运行 `memory-recall --anchor-id <mem-id>`。
- topic corpus 只作为专题复用和 reference pack 的起点；真正导出时通过 `reference-pack --topic <topic>` 选择原始事实来源、runbook、design docs 和 skills。
- 不要把 generated corpus 本身当成唯一事实来源复制到其他仓库。

## 3.6 memory-eval 的定位

`memory-eval` 的职责不是产生新记忆，而是评估“当前 recall 面是否把该命中的事实召回出来了”。

最小用法：

- 维护少量 golden questions，问题本身应能映射到预期来源路径、observation ID 或 claim ID。
- 运行 eval 后输出独立 report，记录命中、漏召回、噪音、预计读取成本和隐私泄漏检查。
- 优先读取 generated report，不把 eval 过程日志当成长久事实来源。

规则：

- golden questions 是评测夹具，不是事实来源。
- eval report 应按 run、suite、日期或 hash 分片，避免变成单文件高频追加日志。
- 如果 recall 长期漏掉某类长期事实，应先修 source 文档、claim 字段或 recall 规则，再刷新 eval；不要直接手工追加 generated 结果掩盖问题。

## 3.7 Generated 白名单与黑名单边界

`.ch/docs/generated/` 只允许存放可重建、可审阅、可删除再生成的文本产物。适合作为白名单的包括：

- recall index、observation registry、claim registry、timeline、topic corpus
- freshness report、consolidation report、eval report、proposal、tombstone
- manifest、summary、JSON / JSONL 摘要和分片 registry

不要把下面内容提交成 `.ch` 的长期协作事实：

- SQLite、DuckDB、向量索引、embedding cache、provider 原始返回
- 无法由仓库内 Markdown/JSON/JSONL 事实源和脚本重建的本地缓存
- 高频追加的 query log、完整 transcript、完整 tool log、运行时临时状态

生成规则：

- generated 产物必须能追溯到 `source_path`，以及可定位的 `source_span` 或 `source_anchor`。
- 需要长期保留的 generated 结果，应带 `generated_by` 或等价脚本入口，以及明确的 `rebuild_command`。
- generated 结果可以删除并重建；一旦需要人工长期维护，就说明它放错了层级。

## 3.8 Proposal-first 与长期事实更新边界

长期事实更新遵循 proposal-first：

- 自动化脚本优先生成 report、proposal、candidate list 或 freshness warning。
- 涉及稳定项目事实、用户偏好、设计约束、runbook、skill 的改动，默认仍由可 review 的 Markdown 变更显式落地。
- 不要因为 generated claim、eval 或 consolidation 结果看起来合理，就静默改写长期事实来源。

只有在事实来源文档完成显式更新后，generated recall 面才应被刷新并反映新状态。generated 索引负责加速召回，不负责替代决策确认。

## 4. 清理与降级规则

- `exec-plans/active/` 完成后，应决定哪些内容上提，哪些只归档。
- `PENDING_ITEMS.md` 中完成的事项应及时删除，或迁到已完成计划中留痕。
- `ACTIVE_RISKS.md` 中已关闭的风险应移除；如果仍有长期复盘价值，迁入 runbook 或历史文档。
- `LESSONS_LEARNED.md` 中如果已经上提成稳定设计、runbook 或 skill，应改成短链接或删除重复条目。
- 热区任何条目一旦失效，就不应继续占据优先召回面。
- claim-lite 一旦进入 `superseded`、`archived` 或 `needs_verification`，应从默认高优先召回输入降级，并在必要时等待 proposal 或人工确认后再更新长期事实来源。

## 5. 收尾检查

每次完成非平凡任务，至少检查下面几项：

1. 当前计划或 handoff 有没有内容应压缩进 L1 `ROLLING_SUMMARY.md`
2. 是否出现了新的失败原因、成功方案或关键决策，应抽取到 L2 `EVENT_MEMORY.md`
3. 是否出现了新的稳定项目事实或用户偏好，应上提到 L3 `PROJECT_CONTEXT.md` / `USER_PREFERENCES.md`
4. 是否出现了新的稳定设计结论，应该写入 `design-docs/`
5. 是否出现了新的用户可见行为变化，应该更新 `product-specs/` 和 `FEATURE_INVENTORY.md`
6. 是否出现了新的复发问题，应该进入 `runbooks/`
7. 是否有重复机械动作，值得提炼成 L4 `skill` 或 `python3` 脚本
8. 是否有内容应标记为 `<private>` 或 `memory_visibility: private`，避免进入 generated recall 面
9. 如果当前仓库已启用 claim-aware index，claim-lite 是否缺少 `status`、来源锚点或 `review_after`
10. 是否需要跑一次 `memory-eval`，确认 golden questions 仍能命中应该优先召回的来源

如果本轮信息同时散落在 handoff、plan、pitfalls 和热区里，难以判断“哪些该上提”，优先运行：

```bash
python3 .agents/skills/memory-consolidator/scripts/consolidate_memory.py
```

先生成 consolidation report，再决定最终写入哪些长期容器。

这套流转规则的目标，是让“仓库内长期记忆”逐步从聊天和临时任务里沉淀出来，而不是永远依赖代理临场回忆。
