# 长期记忆能力改造方案

## 1. 背景与目标

Code Buddy 一类 IDE 已经开始提供“长久记忆”能力：用户在连续使用过程中形成的偏好、项目事实、决策记录、常见约束和协作习惯，可以在后续会话中被自动召回，而不是每次都依赖当前聊天上下文。

当前插件已经具备以下基础：

- 本地状态根目录：`~/.sinitek_cli/`
- 会话元信息：`~/.sinitek_cli/sessions/`
- 会话消息：`~/.sinitek_cli/messages/`
- Prompt 历史：`~/.sinitek_cli/prompt-history/`
- 工作区设置：`~/.sinitek_cli/workspace-settings/`
- Codex / Claude 底层 thread 或 session 映射
- 手动与自动“压缩上下文”能力
- 龙虾任务的结构化沟通文件和任务记录

因此长期记忆不应改造成一个远程服务，也不应直接依赖某个 CLI 的私有记忆机制。更稳妥的方向是：在插件侧新增一个本地、可控、可清理、可解释的记忆层，并在发送 prompt 前按需召回，再注入给 Codex / Claude / Gemini。

目标：

- 支持跨会话、跨重启的长期记忆召回。
- 支持按工作区隔离项目记忆，同时保留少量全局用户偏好记忆。
- 让用户能查看、编辑、禁用、删除记忆。
- 与现有 30 天历史保留策略解耦，避免长期记忆被普通历史清理误删。
- 不破坏现有 CLI 执行链路和会话续接机制。
- 所有新增文案支持中英文国际化。

非目标：

- 不接入远程向量数据库作为默认实现。
- 不把完整聊天记录永久保存为长期记忆。
- 不替代 Codex / Claude / Gemini 官方上下文压缩能力。
- 不自动把敏感信息、密钥、客户数据写入记忆。

## 2. 产品形态

### 2.1 用户可见能力

建议在 AI 对话面板和工具设置中新增：

- “长期记忆”总开关，插件侧默认开启；工具设置可关闭。
- 显式关闭优先：只要全局或项目级设置中出现 `false`，运行时必须按关闭处理，防止兼容旧字段或缺省值把长期记忆误打开。
- “项目记忆”开关，作用域为当前 workspace。
- “全局偏好记忆”开关，作用域为用户本机。
- “查看记忆”入口，列出当前会被召回的记忆。
- “忘记这条记忆”操作，支持单条删除。
- “从本次回答生成记忆”操作，支持用户主动保存。
- “不要记住这个”操作，用于屏蔽某条会话内容。

第一版口径是“默认开启、可随时关闭、关闭优先”。自动提取仍必须受更细粒度开关和触发条件约束，避免把噪音、误解或敏感内容写入长期记忆。

### 2.2 记忆类型

长期记忆不建议用一坨纯文本保存，应做成可检索、可解释的结构化条目：

| 类型 | 说明 | 示例 |
| --- | --- | --- |
| `preference` | 用户偏好 | “用户偏好中文回答，结论先行。” |
| `project_fact` | 项目事实 | “本仓库是 VS Code 插件，主入口是 `src/extension.ts`。” |
| `decision` | 已确认决策 | “长期记忆默认本地保存，不接远程服务。” |
| `constraint` | 稳定约束 | “新增功能必须支持中英文国际化。” |
| `workflow` | 常用工作方式 | “非平凡任务需要任务列表并保持状态同步。” |
| `pitfall` | 反复踩坑 | “不要把 Codex / Claude 协议分支散落到 Webview。” |

## 3. 数据存储设计

### 3.1 存储目录

建议新增：

```text
~/.sinitek_cli/
├── memory/
│   ├── global/
│   │   ├── memories.jsonl
│   │   └── index.json
│   └── workspaces/
│       └── <workspaceKey>/
│           ├── memories.jsonl
│           ├── index.json
│           └── deleted.jsonl
```

说明：

- `global/memories.jsonl` 保存用户级长期偏好。
- `workspaces/<workspaceKey>/memories.jsonl` 保存项目级长期记忆。
- `index.json` 保存轻量检索索引，可先用关键词和时间权重实现，后续再升级 embedding。
- `deleted.jsonl` 记录删除 tombstone，便于后续导入、同步或排障。

### 3.2 条目结构

建议定义 `MemoryItem`：

```ts
type MemoryScope = "global" | "workspace";
type MemoryKind = "preference" | "project_fact" | "decision" | "constraint" | "workflow" | "pitfall";
type MemorySource = "manual" | "assistant_suggested" | "compaction" | "lobster_task" | "session_summary";

type MemoryItem = {
  id: string;
  scope: MemoryScope;
  workspaceKey?: string;
  kind: MemoryKind;
  content: string;
  evidence?: {
    cli?: "codex" | "claude" | "gemini";
    sessionId?: string;
    messageId?: string;
    lobsterTaskId?: string;
    filePath?: string;
  };
  tags: string[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  useCount: number;
  expiresAt?: number;
  pinned?: boolean;
  disabled?: boolean;
};
```

关键点：

- `content` 必须是短句事实，不保存整段聊天。
- `evidence` 只保存引用，不复制敏感原文。
- `confidence` 用于自动提取后的人工审核或低权重召回。
- `expiresAt` 支持临时记忆，例如“本周先按 A 方案推进”。
- `pinned` 的记忆不参与自动过期。
- `disabled` 用于软删除或用户临时关闭。

## 4. 检索与注入设计

### 4.1 注入位置

当前 prompt 发送链路大致为：

1. Webview 发送用户输入。
2. `buildPromptWithAutoContext` 追加当前文件或选区引用。
3. `runPrompt` 根据 CLI 分流。
4. Codex / Claude 走交互式 runner，Gemini 走 one-shot。
5. 上下文压缩由现有 compact 逻辑处理。

长期记忆建议接在 `buildPromptWithAutoContext` 之后、进入具体 CLI runner 之前：

```text
用户原始 prompt
  -> 当前文件/选区自动上下文
  -> 长期记忆召回块
  -> thinking / model prompt 包装
  -> CLI 执行
```

这样可以让 Codex / Claude / Gemini 共享同一套记忆能力，不需要分别改造底层协议。

### 4.2 注入格式

建议统一追加一个明确边界的记忆块：

```text
----
Long-term Memory References:
- [preference][global] 用户偏好中文回答，结论先行。
- [constraint][workspace] 新增功能必须支持中英文国际化。
- [project_fact][workspace] 本仓库是 VS Code 插件，主入口是 src/extension.ts。

Use these memories only when relevant. If they conflict with the current user request, follow the current user request.
```

中文界面下可使用中文标题：

```text
----
长期记忆参考：
- [偏好][全局] 用户偏好中文回答，结论先行。
- [约束][项目] 新增功能必须支持中英文国际化。

仅在相关时使用这些记忆；如果与当前用户请求冲突，以当前用户请求为准。
```

### 4.3 召回策略

第一阶段建议不用复杂向量库，先做可解释的轻量召回：

- 当前 prompt 分词后与 `content`、`tags` 做关键词匹配。
- 工作区记忆优先于全局记忆。
- `constraint`、`preference`、`decision` 默认权重更高。
- 最近使用、用户 pin、命中当前文件路径的记忆加权。
- 单次注入限制 5-10 条，避免污染上下文。
- 注入前过滤 `disabled=true` 和已过期记忆。

后续增强：

- 增加本地 embedding 索引，默认仍可关闭。
- 支持按文件路径、语言、任务类型召回。
- 支持“解释为什么召回这条记忆”。

## 5. 记忆生成设计

### 5.1 用户主动保存

第一阶段优先做主动保存：

- 用户选中 assistant 或 user 消息，点击“记住”。
- 弹出编辑框，允许用户修改记忆内容、类型和作用域。
- 保存后立即写入 `memory/global` 或 `memory/workspaces/<workspaceKey>`。

优点是低风险、可控、容易验证。

### 5.2 回合后建议保存

第二阶段可在任务成功结束后，基于本轮消息生成候选记忆：

- 只生成候选，不自动生效。
- 展示“建议记住 3 条”。
- 用户确认后写入。

候选规则：

- 用户明确表达偏好：可生成 `preference`。
- 用户确认架构或方案：可生成 `decision`。
- 文档或 AGENTS 中的稳定规则：可生成 `constraint`。
- 任务中反复出现的踩坑：可生成 `pitfall`。

### 5.3 压缩上下文联动

现有 compact prompt 已经要求输出 `FACTS / TODOS / DECISIONS / CONSTRAINTS / INDEX`。长期记忆可以复用 compact 结果作为候选来源：

- `FACTS` -> `project_fact`
- `DECISIONS` -> `decision`
- `CONSTRAINTS` -> `constraint`
- `INDEX` 中的稳定文件说明 -> `project_fact`

但不建议 compact 后自动全部入库，应进入“候选记忆审核”。

### 5.4 龙虾任务联动

龙虾任务已有 `main-task.md`、任务记录、子任务沟通文件和最终总结。任务完成时可以提取候选：

- 用户需求覆盖清单 -> `constraint` 或 `workflow`
- 最终方案决策 -> `decision`
- 复发问题和规避方式 -> `pitfall`
- 项目结构事实 -> `project_fact`

同样建议先走用户确认。

## 6. 模块改造建议

### 6.1 新增服务层

建议新增目录：

```text
src/memory/
├── types.ts
├── memoryStore.ts
├── memorySearch.ts
├── memoryExtraction.ts
├── memoryPrompt.ts
└── memoryRetention.ts
```

职责：

- `types.ts`：稳定类型定义。
- `memoryStore.ts`：读写 JSONL、去重、软删除、导入导出。
- `memorySearch.ts`：关键词召回与排序。
- `memoryExtraction.ts`：从 compact / session / lobster 总结生成候选。
- `memoryPrompt.ts`：格式化注入块。
- `memoryRetention.ts`：过期清理、tombstone 清理。

不要把长期记忆逻辑直接塞进 `src/extension.ts`，只在编排层调用。

### 6.2 extension 接线点

建议新增以下编排函数：

```ts
async function buildPromptWithMemory(
  prompt: string,
  options: {
    cli: CliName;
    workspaceKey: string;
    sessionId: string | null;
    tabId: string;
  }
): Promise<{ modelPrompt: string; memoryIds: string[] }>;
```

接线位置：

- `runPromptOneShot` 中构建 `thinkingPrompt` 之前。
- `runPromptInteractive` 中构建交互 prompt 之前。
- 并行 run 和龙虾子任务 prompt 也应复用同一函数。

### 6.3 Webview 协议

建议新增消息类型：

- `getMemoryState`
- `createMemory`
- `updateMemory`
- `deleteMemory`
- `toggleMemory`
- `suggestMemoryFromMessage`
- `acceptSuggestedMemory`
- `rejectSuggestedMemory`

对应 UI：

- 工具设置中的长期记忆开关。
- 历史记录或独立弹窗中的“记忆” tab。
- 消息气泡操作菜单中的“记住 / 不要记住”。

### 6.4 配置项

建议放入工具设置，并落盘到现有 settings 体系。长期记忆开关只控制插件侧本地记忆层的查看、写入、召回和 prompt 注入，不控制 Codex / Claude / Gemini 外部 CLI 自带的记忆、历史、压缩、配置或云端能力。

全局：

```json
{
  "longTermMemoryEnabled": true,
  "memoryEnabled": true,
  "globalMemoryEnabled": true,
  "memoryAutoSuggestEnabled": true,
  "memoryMaxInjectedItems": 8
}
```

工作区：

```json
{
  "longTermMemoryEnabled": true,
  "workspaceMemoryEnabled": true,
  "memoryAutoExtractAfterCompact": false,
  "memoryAutoExtractAfterLobsterTask": false
}
```

默认建议：

- `longTermMemoryEnabled=true`，插件侧长期记忆默认开启。
- 工具设置可以关闭长期记忆；关闭后不得新建、更新、召回或注入记忆，只允许查看、导出和删除已有记忆。
- 兼容旧字段时采用“显式 false 防误开优先”：`longTermMemoryEnabled=false`、`memoryEnabled=false`、`globalMemoryEnabled=false` 或 `workspaceMemoryEnabled=false` 任一命中对应作用域时，都必须关闭对应长期记忆能力。
- `memoryAutoSuggestEnabled=true` 只生成候选，不直接写入。
- 自动提取默认关闭；只有总开关开启，且 `memoryAutoExtractAfterCompact=true` 或 `memoryAutoExtractAfterLobsterTask=true` 命中对应触发源时，才允许从 compact 或龙虾任务总结生成候选/记忆。

设置解析矩阵：

| 全局 `longTermMemoryEnabled` / legacy `memoryEnabled` | 作用域开关 | 自动提取开关 | 允许行为 |
| --- | --- | --- | --- |
| 缺失或 `true` | 缺失或 `true` | 不适用 | 可查看、创建、更新、删除、召回和注入插件侧长期记忆 |
| 任一显式 `false` | 任意 | 任意 | 长期记忆关闭；只允许查看、导出和删除，不允许创建、更新、召回或注入 |
| 缺失或 `true` | 显式 `false` | 任意 | 对应 global/workspace 作用域关闭；只允许查看、导出和删除该作用域记忆 |
| 缺失或 `true` | 缺失或 `true` | `memoryAutoExtractAfterCompact=false` | compact 后不自动新增或更新 memory 目录 |
| 缺失或 `true` | 缺失或 `true` | `memoryAutoExtractAfterLobsterTask=false` | 龙虾任务后不自动新增或更新 memory 目录 |
| 缺失或 `true` | 缺失或 `true` | 对应触发源为 `true` | 仅在任务成功完成、提取内容通过敏感扫描且满足候选/确认策略时，才允许写入或更新 memory 目录 |

## 7. 隐私与安全

长期记忆会放大隐私风险，必须从第一版就做约束：

- 默认不保存密钥、token、cookie、证书、生产地址、客户数据。
- 保存前做敏感模式扫描，例如 `sk-`、`ghp_`、`AKIA`、`BEGIN PRIVATE KEY`、`.env` 常见键名。
- 对疑似敏感内容弹窗确认，默认拒绝保存。
- 用户必须能一键关闭长期记忆。
- 用户必须能按全局、工作区、单条记忆删除。
- 导出记忆时给出明显提示。
- 日志中不要记录完整记忆正文，只记录 id、类型、作用域和数量。
- 记忆注入到 CLI 前应计入 debug 诊断，但默认不展示全文日志。

## 8. 保留与清理策略

现有历史默认 30 天清理，长期记忆不应直接套用该策略。

建议：

- 普通长期记忆默认不过期。
- 自动候选未确认超过 30 天清理。
- `expiresAt` 到期的记忆自动禁用或删除。
- `deleted.jsonl` tombstone 保留 90 天。
- 工作区被清理时，不自动删除工作区记忆，除非用户显式选择。
- 提供“清空当前项目记忆”和“清空全部记忆”。

## 9. 与现有能力的关系

### 9.1 与会话历史

会话历史是完整聊天记录，适合恢复 UI 和导出。长期记忆是短事实，适合跨会话召回。两者应分开存储。

### 9.2 与上下文压缩

上下文压缩服务于当前 thread / session 的续接，长期记忆服务于未来任务召回。compact 的摘要可以作为候选来源，但不是记忆本身。

### 9.3 与 CLI 原生记忆

不同 CLI 的原生能力不一致。插件侧长期记忆应作为统一能力，注入到 prompt，而不是写入 Codex / Claude / Gemini 的私有配置。

后续如果某个 CLI 提供稳定官方记忆 API，可以作为可选同步适配，但不能成为默认依赖。

工具设置中的长期记忆开关仅控制插件侧 `~/.sinitek_cli/memory/` 记忆层；它不会清理、禁用或覆盖 Codex / Claude / Gemini 外部 CLI 自带的历史、记忆、配置、压缩结果或账号侧能力。用户如果需要关闭外部 CLI 自带能力，必须到对应 CLI 官方配置中处理。

### 9.4 与 AGENTS / 项目文档

AGENTS 和 `.ch/docs/` 是仓库内事实来源。长期记忆可以记录“用户常用方式”和“项目实践经验”，但不能覆盖仓库文档中的明确规则。

召回提示中必须声明：

```text
Repository files and current user instructions override long-term memory.
```

## 10. 分阶段实施计划

### Phase 1：本地记忆存储与手动保存

范围：

- 新增 `src/memory/*`。
- 新增 `~/.sinitek_cli/memory/` 数据结构。
- 支持手动创建、查看、删除项目记忆和全局记忆。
- 工具设置增加长期记忆开关。
- Webview 增加最小记忆管理入口。
- 支持中英文文案。

验收：

- 关闭开关时不会创建、更新、召回或注入任何记忆；memory 目录不得出现新增或更新时间变化。
- 关闭开关后 UI/API 只允许查看、导出和删除已有记忆。
- 手动保存后重启 VS Code 仍可查看。
- 删除记忆后不会再被召回。
- `npm run build` 通过。

### Phase 2：发送前召回与 prompt 注入

范围：

- 在 prompt 执行前召回相关记忆。
- 对 Codex / Claude / Gemini 统一注入。
- 消息 trace 或运行详情中显示“本次使用了 N 条记忆”，但不默认暴露全文。
- 写入 `lastUsedAt` 和 `useCount`。

验收：

- 同一项目新会话可以召回项目记忆。
- 其他项目不会召回当前项目记忆。
- 全局偏好可跨项目召回。
- 单次注入数量受配置限制。

### Phase 3：候选记忆建议

范围：

- 从本轮成功任务、compact 摘要、龙虾最终总结中生成候选记忆。
- 用户确认后才写入正式记忆。
- 支持拒绝候选并记录不再重复提示。

验收：

- 候选记忆不会自动进入 prompt。
- 拒绝后不会立即重复出现同一候选。
- 敏感内容会被拦截或要求二次确认。

### Phase 4：检索增强与导入导出

范围：

- 引入可选本地 embedding 或更强关键词索引。
- 支持导出 / 导入记忆。
- 支持按文件路径、标签、任务类型筛选。
- 增加记忆使用诊断页面。

验收：

- embedding 不可用时仍能回退关键词检索。
- 导入重复记忆时能去重。
- 诊断页面能解释每条记忆的召回原因。

## 11. 主要风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 记忆污染 | 错误事实长期影响回答 | 默认人工确认、保留 evidence、支持禁用和删除 |
| 隐私泄露 | 敏感内容被反复注入 CLI | 敏感扫描、显式关闭优先、日志脱敏 |
| 上下文膨胀 | 每次 prompt 变长、降低质量 | 限制条数、短句化、相关性排序 |
| 多事实来源冲突 | 记忆与当前文档或用户指令冲突 | 注入提示明确优先级，当前请求和仓库文件优先 |
| extension.ts 继续膨胀 | 后续维护困难 | 新增 `src/memory/` 服务层，extension 只接线 |
| 国际化遗漏 | 新功能中文或英文缺失 | UI、命令、提示和错误统一走现有 i18n 机制 |

## 12. 推荐结论

如果当前插件要支持类似 Code Buddy 的长期记忆，建议采用“插件侧本地记忆层”方案：

1. 先做手动保存和可视化管理，避免自动记忆带来的污染和隐私风险。
2. 再做发送前轻量召回，把记忆作为明确边界的参考块注入 prompt。
3. 最后接入 compact、龙虾任务总结和 embedding 检索，逐步提高自动化程度。

这个方案改造面可控，能复用现有 `~/.sinitek_cli/` 数据目录、会话历史、上下文压缩和 Webview 配置体系，也不会把插件绑定到某一个 CLI 的私有能力上。
