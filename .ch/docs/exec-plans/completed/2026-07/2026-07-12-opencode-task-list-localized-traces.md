# OpenCode 任务列表解析与工具气泡标题本地化

- 日期：2026-07-12
- 状态：completed
- 当前阶段：实现、文档、测试与构建均已完成
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
4. 补充回归测试、运行时事实文档和功能清单。

## 范围

- OpenCode JSONL `tool_use` / `tool-use` / `tool` 事件解析。
- `todowrite` 的 `state.input.todos` 主格式，以及 metadata/output 兼容读取。
- Webview trace 工具标题的中英文映射。
- OpenCode 命令解析测试、Webview 标题映射测试、相关文档。

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
- [x] 定向单测与 Node 构建通过。

## 影响面

- 代码目录：`src/cli/`、`src/extension.ts`、`src/webview/`、`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：无技术栈或配置变更

## 风险与缓解

- 风险：OpenCode 不同版本把 todos 放在 input、metadata 或 output。
- 缓解：仅在 `todowrite` 工具上做有界兼容解析，并区分“无任务字段”和“显式空列表”。
- 风险：工具名本地化影响 Claude 等共用 trace 渲染。
- 缓解：只映射稳定已知别名，未知名称原样回退，并补纯函数测试。

## 验证计划

- 最小相关验证：OpenCode todo 解析与 visible event 测试；Webview 工具标题映射测试。
- 单元自测命令：`node --test dist/test/openCodeTaskList.test.js dist/test/opencodeCommandRunner.test.js dist/test/traceToolTitleLocalization.test.js`
- 扩展验证：`npm run build`

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/openCodeTaskList.test.ts`、`src/test/traceToolTitleLocalization.test.ts`，更新 `src/test/opencodeCommandRunner.test.ts`
- 单元自测结果：`npm run build` 通过；定向 OpenCode/标题测试 `41/41` 通过；Claude/Codex/提示词共享回归 `16/16` 通过；全量 `node --test dist/test/*.test.js` 为 `458/458` 通过
- 失败处理记录：无
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关文档同步：已更新能力规格与 CLI 运行时参考

## 任务列表

- [x] 检查最近 OpenCode 日志格式
- [x] 定位任务列表与 trace 渲染链路
- [x] 实现 OpenCode todo 归一化与消息转发
- [x] 实现工具气泡标题本地化
- [x] 补充测试和事实文档
- [x] 完成构建验证并归档计划

## 决策记录

- 2026-07-12：真实日志确认主格式为 `part.state.input.todos[]`，字段为 `content/status/priority`。
- 2026-07-12：任务列表复用现有 `taskListUpdate` 协议；工具 trace 继续保留，不把任务列表正文重复塞入气泡。
- 2026-07-12：标题本地化在 Webview 展示层完成，以便 Codex、Claude、OpenCode 共用已知工具别名映射且不污染存档原文。
- 2026-07-12：并行 OpenCode tab 复用同一 JSONL 分块消费函数，仅定向转发任务列表更新，避免后台运行漏报。

## 当前结论

OpenCode `todowrite` 已按真实日志格式解析，并覆盖前台与并行 tab；常见工具标题已本地化，未知工具和详情原文保持不变。构建、定向回归、共享回归和全量 Node 测试全部通过，`media/official_skills_catalog.json` 的 56 条 description 也已确认均包含中文。
