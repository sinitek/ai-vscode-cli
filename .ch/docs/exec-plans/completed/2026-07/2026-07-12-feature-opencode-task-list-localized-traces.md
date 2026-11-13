# OpenCode 任务列表解析与工具气泡标题本地化

- 日期：2026-07-12
- 状态：completed
- 当前阶段：运行时实现与构建完成；独立测试计划已删除、历史验证证据见删除审计，事实文档见关联计划
- 负责人：Codex
- owner：当前用户会话
- claimed_at：2026-07-12T15:20:00+08:00
- claim_ttl：本任务完成即释放
- handoff_to：无

## 背景

最近的 OpenCode JSONL 日志中，任务列表通过 `tool_use` 事件里的 `todowrite` 工具输出，任务位于 `part.state.input.todos`，单项包含 `content`、`status`、`priority`。当前插件只把该事件压缩为 `tool todowrite / status / N todos` trace 气泡，丢失任务明细，因此 AI 对话面板的任务列表不会更新；同时 OpenCode 工具气泡标题直接显示 `read`、`grep`、`glob`、`todowrite` 等英文工具名。

## 目标

1. 从 OpenCode `todowrite` JSONL 事件中稳定提取 `{ text, done }` 任务列表。
2. 把提取结果通过现有 `taskListUpdate` 协议实时发送到对应 AI 对话 tab。
3. 保留工具 trace 气泡，并按当前界面语言本地化已知工具标题；未知工具继续显示原名。
4. 实现 OpenCode 任务列表与工具标题本地化运行时行为。

## 范围

- OpenCode JSONL `tool_use` / `tool-use` / `tool` 事件解析。
- `todowrite` 的 `state.input.todos` 主格式，以及 metadata/output 兼容读取。
- Webview trace 工具标题的中英文映射。
- 本计划只覆盖 OpenCode 命令解析、任务列表转发与 Webview 标题映射运行时。

原历史验证证据见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)，事实文档与功能清单已同步。两项分别依赖本计划定义的 todowrite 解析与本地化行为；原计划的测试和文档结果由对应计划承接。

## 非目标

- 不改变 OpenCode CLI、模型或运行参数。
- 不改变任务列表 UI 样式、状态模型或持久化策略。
- 不翻译命令、文件路径、正则表达式等工具详情正文。
- 不替换现有 Codex / Claude 任务列表实现。

## 验收标准

- [x] OpenCode `todowrite` 的 pending / in_progress / completed 任务可归一化并实时显示。
- [x] 空 `todos` 可清空当前运行的任务列表。
- [x] `read`、`grep`、`glob`、`bash`、`apply_patch`、`todowrite`、`webfetch` 等常见工具标题在中文界面显示中文。
- [x] 未识别工具标题保持原名，不误改详情正文。
- [x] Node 构建通过；测试结果和测试交付由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)承接。

## 影响面

- 代码目录：`src/cli/`、`src/extension.ts`、`src/webview/`、`src/test/`
- 文档目录：无（事实文档由关联 docs 计划承接）
- 配置与脚本：无技术栈或配置变更

## 风险与缓解

- 风险：OpenCode 不同版本把 todos 放在 input、metadata 或 output。
- 缓解：仅在 `todowrite` 工具上做有界兼容解析，并区分“无任务字段”和“显式空列表”。
- 风险：工具名本地化影响 Claude 等共用 trace 渲染。
- 缓解：只映射稳定已知别名，未知名称原样回退，并补纯函数测试。

## 验证计划

- 验证计划：[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)记录历史定向、共享回归和全量测试；本计划保留原构建结果 `npm run build` 通过。

## 测试与清单同步

- 本计划没有测试开发交付；历史测试结果见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)。
- 本计划不认领功能清单或运行时文档编写；同步事实见关联 docs 计划。

## 任务列表

- [x] 检查最近 OpenCode 日志格式
- [x] 定位任务列表与 trace 渲染链路
- [x] 实现 OpenCode todo 归一化与消息转发
- [x] 实现工具气泡标题本地化
- [x] 将测试开发与事实文档分别交由关联计划承接
- [x] 完成构建验证并归档计划

## 决策记录

- 2026-07-12：真实日志确认主格式为 `part.state.input.todos[]`，字段为 `content/status/priority`。
- 2026-07-12：任务列表复用现有 `taskListUpdate` 协议；工具 trace 继续保留，不把任务列表正文重复塞入气泡。
- 2026-07-12：标题本地化在 Webview 展示层完成，以便 Codex、Claude、OpenCode 共用已知工具别名映射且不污染存档原文。
- 2026-07-12：并行 OpenCode tab 复用同一 JSONL 分块消费函数，仅定向转发任务列表更新，避免后台运行漏报。

## 当前结论

OpenCode `todowrite` 已按真实日志格式解析，并覆盖前台与并行 tab；常见工具标题已本地化，未知工具和详情原文保持不变。原计划记载构建通过；定向 `41/41`、共享 `16/16`、全量 `458/458` 的测试证据见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)，功能清单与运行时事实同步见关联 docs 计划。原文另记载 `media/official_skills_catalog.json` 的56条 description均包含中文，此项作为既有协调背景保留，不构成本计划交付。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
