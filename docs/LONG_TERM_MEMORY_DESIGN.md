# 长期记忆四层设计方案

## 1. 背景

当前这份 VS Code 插件已经有会话历史、消息存档、prompt history、龙虾任务记录和工具设置，但这些都不等于“长期记忆”。

之前的方案把长期记忆近似成：

- 一组 `MemoryItem`
- 一个 `<workspace>/.ch/docs/memory/` 目录
- 若干 JSONL / JSON 索引文件

这个方向过于扁平，适合做存储原型，不适合做可长期维护、可压缩、可召回、可治理的记忆系统。

参考目标系统 `/Users/fangjiawei/sinitek/sinitek_codex_harness/app` 的记忆设计后，更合适的方案不是“记更多 JSON”，而是采用四层记忆模型：

- `Working`
- `Episodic`
- `Semantic`
- `Procedural`

再配合一层 generated recall 产物，用于运行时低成本召回。

## 2. 本插件的适配原则

本插件只引入“长期记忆”这一项能力，不照搬目标系统全部机制。

### 2.1 保留

- 四层记忆的分层思路
- 热区记忆文件作为长期事实来源
- generated recall/index 作为低成本召回层
- 记忆压缩、上提、去重、过期和隐私边界

### 2.2 不照搬

- 不要求改业务规则文件或用户自己的项目规范
- 不要求首版就实现完整的 claim registry、memory eval、reference pack

原因很简单：本插件在执行任务前可以动态注入补充提示词，因此长期记忆的使用入口应该是：

```text
记忆召回 -> 生成本次补充提示词 -> 注入到运行时 prompt
```

工作区 scaffold 本身可以直接采用目标系统的 `.ch` / `.agents` 结构，但具体任务使用仍然通过运行时 prompt 注入完成，而不是按每次 recall 动态改写规则文件。

## 3. 存储范围与位置

长期记忆应该以“当前工作区隔离”为默认模型，而不是先做全局共享。

建议存储在当前工作区 harness scaffold：

```text
<workspace>/
  .ch/docs/memory/
  .ch/docs/generated/memory-index/
  .ch/docs/runbooks/PITFALLS.md
  .agents/
  ARCHITECTURE.md
  AGENTS.md
  CLAUDE.md
```

而不是首版就把记忆正文放到用户 home 目录下统一聚合。

这样做有几个直接好处：

- 不同项目之间天然隔离，减少误召回。
- 和记忆内容强相关的代码、文档、任务背景都在同一工作区语义下。
- 用户删除项目目录时，记忆与协作 scaffold 可以一起清理，边界清晰。
- 更接近目标系统“仓库内长期记忆”的治理方式。

注意：

- 当前实现里，工具设置和会话历史仍然大量使用 `~/.sinitek_cli/`。
- 当前实现把插件侧长期记忆正文落到工作区 `.ch/docs/memory/`，generated recall 落到 `.ch/docs/generated/memory-index/`，踩坑记录落到 `.ch/docs/runbooks/PITFALLS.md`；普通历史、workspace settings 和会话存档仍保留在 `~/.sinitek_cli/`。

## 4. 四层记忆模型

### 4.1 Working

含义：当前任务正在使用、但还不应沉淀为长期记忆的上下文。

在本插件里的典型来源：

- 当前 tab 的消息流
- `pendingSessionDrafts`
- 当前运行的 trace
- 当前轮龙虾任务的主/子任务上下文
- 当前 prompt 的附件、文件标签、临时补充说明

Working 层不是长期记忆正文的最终落盘位置。它的职责是作为记忆提炼的输入层。

### 4.2 Episodic

含义：一次会话、一轮任务、一个阶段发生了什么。

这层适合存：

- 阶段摘要
- 关键任务结果
- 某轮龙虾执行的结论
- 某次 compact 后压缩出的高价值摘要
- 当前仍未关闭的待办或风险

建议文件：

```text
<workspace>/.ch/docs/memory/
  ROLLING_SUMMARY.md
  EVENT_MEMORY.md
  PENDING_ITEMS.md
  ACTIVE_RISKS.md
```

建议职责：

- `ROLLING_SUMMARY.md`：压缩较旧但仍有价值的会话脉络
- `EVENT_MEMORY.md`：记录关键事件、成功方案、失败原因、重要决策
- `PENDING_ITEMS.md`：跨会话仍未完成的事项
- `ACTIVE_RISKS.md`：当前仍有效的风险与注意点

### 4.3 Semantic

含义：稳定、可反复复用的事实。

这层适合存：

- 项目事实
- 稳定约束
- 用户偏好
- 持续有效的结构结论
- 长期适用的术语约定

建议文件：

```text
<workspace>/.ch/docs/memory/
  PROJECT_CONTEXT.md
  USER_PREFERENCES.md
```

建议职责：

- `PROJECT_CONTEXT.md`：技术栈、目录边界、稳定规则、关键命令、重要集成方式
- `USER_PREFERENCES.md`：用户明确表达过、希望后续持续生效的协作偏好

这层才是长期记忆召回时最优先读取的内容。

### 4.4 Procedural

含义：重复执行的方法、踩坑规避套路和可程序化经验。

这层适合存：

- 固定操作流
- 可复用排障步骤
- 稳定的验证套路
- 多次复用后证明有效的经验

建议文件：

```text
<workspace>/.ch/docs/memory/
  LESSONS_LEARNED.md
<workspace>/.ch/docs/runbooks/
  PITFALLS.md
```

建议职责：

- `LESSONS_LEARNED.md`：记录“以后再遇到类似问题应该怎么做”
- `.ch/docs/runbooks/PITFALLS.md`：记录仍有复发风险或长期规避价值的真实踩坑，结构保持“现象、触发条件、根因、长期规避、验证方式、关联资料”

如果未来某条经验已经足够稳定，也可以进一步沉淀为插件内置操作流、helper 或脚本，但首版长期记忆仍以 Markdown 为主。

## 5. 目录设计

建议长期记忆目录结构如下：

```text
<workspace>/
  .ch/
    docs/
      memory/
        README.md
        ROLLING_SUMMARY.md
        EVENT_MEMORY.md
        PROJECT_CONTEXT.md
        USER_PREFERENCES.md
        PENDING_ITEMS.md
        ACTIVE_RISKS.md
        LESSONS_LEARNED.md
      runbooks/
        PITFALLS.md
      generated/
        memory-index/
          index.md
          recall-index.md
          observations.jsonl
          recall-pack.md
          consolidation-report.md
          manifest.json
  .agents/
  ARCHITECTURE.md
  AGENTS.md
  CLAUDE.md
```

说明：

- `.ch/docs/memory/*.md` 与 `.ch/docs/runbooks/PITFALLS.md` 是长期记忆的原始事实来源
- `.ch/docs/generated/memory-index/*` 是可重建的召回产物，不是最终事实来源

不建议首版直接把记忆正文做成主存储 JSONL，原因是：

- Markdown 更适合人工审阅和手工修正
- 更符合目标系统的 source-first 设计
- 方便代理在收尾时做压缩、上提和去重
- generated JSONL 更适合作为索引，而不是唯一真相

## 6. generated recall 层

四层记忆如果只有原始 Markdown，召回成本会逐渐变高，所以需要一层 generated recall。

建议生成物：

- `generated/index.md`
- `generated/recall-index.md`
- `generated/observations.jsonl`
- `generated/recall-pack.md`
- `generated/consolidation-report.md`
- `generated/manifest.json`

### 6.1 index.md

记录：

- 本次索引生成时间
- 纳入索引的源文件
- 文件 hash 或 mtime
- 生成模式和读取建议

### 6.2 recall-index.md

用于快速浏览“当前有哪些可召回记忆主题”，适合作为运行时召回的第一层筛选面。

### 6.3 observations.jsonl

这不是主记忆存储，而是 generated observation registry。

每条 observation 至少包含：

- `id`
- `layer`
- `title`
- `summary`
- `source_path`
- `content_hash`
- `read_cost`
- `updated_at`

### 6.4 recall-pack.md

这是运行时最关键的产物。

它表示：

- 围绕当前 prompt / 当前文件 / 当前任务 focus
- 预先裁剪出的、适合直接注入本次补充提示词的记忆包

### 6.5 consolidation-report.md

用于提示哪些内容应该从 Working / Episodic 上提到更稳定的层：

- 哪些摘要应该进入 `EVENT_MEMORY.md`
- 哪些事实应该进入 `PROJECT_CONTEXT.md`
- 哪些偏好应该进入 `USER_PREFERENCES.md`
- 哪些经验应该进入 `LESSONS_LEARNED.md`
- 哪些失败、阻塞、回滚或明确“踩坑”信号应该进入 `.ch/docs/runbooks/PITFALLS.md`

## 7. 记忆流转规则

### 7.1 入口不是“直接写长期记忆”

默认流程应是：

1. 当前任务执行
2. 产生会话消息、compact 摘要、龙虾总结、手动“记住这条”
3. 先形成候选摘要
4. 再决定进入哪一层长期记忆
5. 重新生成 recall/index

不建议把原始消息直接塞进长期记忆。

当前插件的自动踩坑记录属于保守上提：只有任务结果或失败总结中出现明确 `pitfall / gotcha / 踩坑 / 报错 / 失败 / 阻塞 / 回滚` 等信号，并伴随根因、规避或验证线索时，才写入 `.ch/docs/runbooks/PITFALLS.md`。自动条目的根因如果来自模型总结而非人工确认，需要保留“需观察 / 待核验”的状态，不应当作不可变事实。

### 7.2 上提规则

建议按下面规则流转：

- Working -> Episodic
  - 当某轮会话结束，需要保留阶段脉络，但还不够稳定时
- Episodic -> Semantic
  - 当某条事实已经稳定到后续多轮任务都应该默认知道
- Episodic -> Procedural
  - 当某个做法已经能总结成“以后都这样做”

### 7.3 各层典型来源

- `ROLLING_SUMMARY.md`
  - 会话压缩摘要
  - 龙虾任务阶段总结
  - 多轮任务收口摘要
- `EVENT_MEMORY.md`
  - 某次失败根因
  - 某次成功落地方案
  - 关键迁移、回滚、验收结论
- `PROJECT_CONTEXT.md`
  - 项目结构事实
  - 稳定边界约束
  - 常用验证命令
- `USER_PREFERENCES.md`
  - 用户偏好中文/英文
  - 代码风格或交付偏好
- `LESSONS_LEARNED.md`
  - 反复复用的做法
  - 固定的排障顺序
- `.ch/docs/runbooks/PITFALLS.md`
  - 真实失败或阻塞后的规避记录
  - 已确认会复发的坑点
  - 需要后续任务优先避开的兼容性、运行时或验证问题
- `PENDING_ITEMS.md`
  - 跨会话待办
- `ACTIVE_RISKS.md`
  - 仍未关闭的风险

## 8. 运行时召回与注入

这是与目标系统最大的适配差异。

目标系统中，一部分长期记忆会通过规则文件、热区和 recall 工具影响后续任务。

本插件不需要这样做。因为插件掌握任务启动入口，可以直接在执行前注入补充提示词。

### 8.1 注入位置

建议接在当前 prompt 组装链路里：

```text
用户输入
  -> 当前文件/选区自动上下文
  -> 召回长期记忆
  -> 生成补充提示词块
  -> 和本次 prompt 一起送给 Codex / Claude / Gemini
```

### 8.2 注入内容来源

优先级建议如下：

1. `PROJECT_CONTEXT.md`
2. `USER_PREFERENCES.md`
3. ``.ch/docs/runbooks/PITFALLS.md``
4. `LESSONS_LEARNED.md`
5. `ACTIVE_RISKS.md`
6. `PENDING_ITEMS.md`
7. `EVENT_MEMORY.md`
8. `ROLLING_SUMMARY.md`

理由：

- 先给稳定事实
- 再给用户偏好
- 再给真实踩坑和规避方式
- 再给可复用方法
- 最后才补近期事件和滚动摘要

### 8.3 注入形式

建议生成一个明确边界的补充提示词块，而不是静默拼接：

```text
[Plugin Memory Context]
Project Context:
- ...

User Preferences:
- ...

Lessons Learned:
- ...

Open Risks:
- ...

Recent Relevant Events:
- ...

Use this memory only when relevant. Current user request overrides stale memory.
```

中文界面下也可输出中文版本，但边界必须明显。

### 8.4 Scaffold 与运行时边界

本方案会自动初始化工作区 scaffold，但不会按每次 recall 结果去改写规则内容：

- 允许复制目标系统同构的 `.ch/`、`.agents/`、`ARCHITECTURE.md` 模板
- 允许缺失时创建根级 `AGENTS.md`，已存在时按幂等标记 append 模板
- 允许缺失时创建根级 `CLAUDE.md`，内容只引用 `AGENTS.md`，已有文件不覆盖也不追加
- 不根据单次 recall 动态重写 `.ch/docs/*`、`AGENTS.md` 或 `.agents/*`

原因：

- scaffold 是稳定骨架，适合一次性安装
- recall 是本次任务语境，适合运行时注入
- 两者职责分离后，既能共享目标系统结构，又能降低脏写风险

## 9. 用户可见能力

工具设置“工作区”页中的 harness 骨架开关默认关闭，开启时必须先弹窗确认是否初始化工作区骨架。用户确认后，扩展安装 `media/workspace-scaffold` 对应的 `.ch/`、`.agents/`、`ARCHITECTURE.md`、`AGENTS.md`、`CLAUDE.md`，并创建或补充根级 `.gitignore` 以忽略 `.codegraph/`，随后在终端启动 CodeGraph 设置；用户取消时保持关闭，不写入启用状态。骨架安装成功后，扩展会再弹窗询问是否由 AI 初始化 `ARCHITECTURE.md`，确认后当前 AI 对话会切到编码模式并使用当前选择的 CLI 分组、配置和模型发起项目架构分析任务。

该开关同时控制“插件侧记忆系统是否参与本次任务”。

开启时允许：

- 召回长期记忆
- 生成 recall pack
- 从 compact / 龙虾结果里提炼候选
- 用户手动记住内容

关闭时应禁止：

- 自动召回
- 自动注入
- 自动提炼
- 自动写入或更新长期记忆

兼容规则：

- 如果工作区已存在 `.ch`、`.agents`、`AGENTS.md`、`CLAUDE.md` 或 `ARCHITECTURE.md`，则按“缺失即补齐、已有不覆盖”的策略继续安装 scaffold。
- 根级 `AGENTS.md` 若已存在，则只追加一次带标记块的 harness 模板。
- 根级 `CLAUDE.md` 若已存在，则保持原样；若缺失，则创建一个只指向 `AGENTS.md` 的轻量入口。
- 根级 `.gitignore` 若缺失则创建；若已存在则只补充一次 `.codegraph/`，避免提交 CodeGraph 本地索引缓存。
- 骨架初始化收尾时会二次确认是否初始化 `ARCHITECTURE.md`；确认后通过当前 AI 对话发起 coding 任务，让 AI 阅读当前项目并更新 `ARCHITECTURE.md` 的真实架构内容。
- 扩展激活、工作区切换、首次 recall / inject / 持久化都不再无条件安装 scaffold；只有显式开启并确认初始化后才安装。
- 确认初始化后会在当前工作区终端执行 `codegraph install --target codex --location global && codegraph init`，让 CodeGraph 安装/索引过程对用户可见。

关闭时仍可允许：

- 查看已有记忆文件
- 导出
- 删除

## 10. 模块设计建议

当前插件不适合继续沿用“`memoryStore.ts` 做主存储”的想法。

更合适的模块拆分是：

```text
src/memory/
  memoryPaths.ts
  memoryFiles.ts
  memoryIndexer.ts
  memoryRecall.ts
  memoryConsolidator.ts
  memoryPrompt.ts
  runtimeGate.ts
```

职责建议：

- `memoryPaths.ts`
  - 统一解析 `<workspace>/.ch/docs/memory/`、`.ch/docs/generated/memory-index/`、`.ch/docs/runbooks/PITFALLS.md`
- `memoryFiles.ts`
  - 读写各个 Markdown 记忆文件
- `memoryIndexer.ts`
  - 从 Markdown 热区生成 `generated/*`
- `memoryRecall.ts`
  - 按当前 focus 选择相关 observation，构建 recall pack
- `memoryConsolidator.ts`
  - 把 compact / lobster / 手动候选上提到正确层级
- `memoryPrompt.ts`
  - 把 recall pack 变成最终注入 prompt 的补充块
- `runtimeGate.ts`
  - 统一控制开启/关闭和允许矩阵

其中：

- Markdown 热区文件是 source of truth
- `generated/*.jsonl` 只是低成本索引
- 运行时永远优先读 source 和 generated 组合，而不是只读 JSONL

## 11. 和现有插件能力的关系

### 11.1 会话历史

会话历史仍保存在插件现有历史系统中，职责是：

- 恢复消息流
- 导出历史会话
- 支持续接

它不是长期记忆正文。

### 11.2 compact

compact 的职责是压缩当前上下文，不是直接变成长期记忆。

它更适合作为：

- `ROLLING_SUMMARY.md` 的候选来源
- `EVENT_MEMORY.md` 的候选来源

### 11.3 龙虾任务

龙虾主从执行和红蓝辩论会产生很多高价值结构化结论。

这些结果不应直接原样进长期记忆，而应：

- 阶段性总结进入 `ROLLING_SUMMARY.md`
- 关键决策进入 `EVENT_MEMORY.md`
- 稳定项目事实进入 `PROJECT_CONTEXT.md`
- 可复用方法进入 `LESSONS_LEARNED.md`

### 11.4 工具设置

工具设置只负责控制长期记忆能力是否参与任务，以及自动提炼的细分开关。

它不应该承担长期记忆正文本身。

## 12. 隐私与边界

长期记忆必须默认防止下面内容进入热区或 generated recall：

- 密钥
- token
- cookie
- 客户数据
- 生产地址
- 只适用于当前会话的临时敏感说明

建议在记忆文件与 generated 索引生成时都支持忽略标记，例如：

- `<private>...</private>`
- `<no-memory>...</no-memory>`
- `memory_visibility: private`

## 13. 分阶段落地建议

### Phase 1：工作区记忆热区文件

目标：

- 在工作区补齐 `.ch/`、`.agents/`、`ARCHITECTURE.md`、`AGENTS.md`、`CLAUDE.md` 和忽略 `.codegraph/` 的 `.gitignore` scaffold；初始化收尾可二次确认并通过当前 AI 对话初始化 `ARCHITECTURE.md`
- 在 `<workspace>/.ch/docs/memory/` 建立四层文件骨架
- 接入工具设置开关
- 接入基础读写

### Phase 2：generated recall

目标：

- 从热区文件生成 `generated/index.md`
- 生成 `observations.jsonl`
- 生成 `recall-pack.md`

### Phase 3：运行时注入

目标：

- 在任务执行前基于 focus 召回记忆
- 生成补充提示词块并注入
- 不改规则文件

### Phase 4：自动上提

目标：

- 从 compact
- 从龙虾最终总结
- 从用户手动记住

提炼候选并上提到正确层级

## 14. 推荐结论

当前插件的长期记忆设计不应继续沿“扁平 `MemoryItem` + JSONL 主存储”扩展。

更稳妥的目标方案是：

1. 以当前工作区 harness scaffold 作为长期记忆正文目录：热区位于 `.ch/docs/memory/`，踩坑位于 `.ch/docs/runbooks/PITFALLS.md`。
2. 以目标系统的四层记忆模型组织内容：`Working / Episodic / Semantic / Procedural`。
3. 以 `ROLLING_SUMMARY / EVENT_MEMORY / PROJECT_CONTEXT / USER_PREFERENCES / LESSONS_LEARNED / PENDING_ITEMS / ACTIVE_RISKS` 作为热区文件，并把 `PITFALLS.md` 归入 runbook。
4. 以 `.ch/docs/generated/memory-index/*` 作为低成本 recall 层，而不是主事实来源。
5. 以“工作区 scaffold + 运行时补充提示词注入”作为使用入口，不按单次 recall 动态改写规则文件。

这样既能借用目标系统成熟的长期记忆分层思想，又能贴合 VS Code 插件的实际执行链路和边界。
