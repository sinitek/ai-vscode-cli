## 长期记忆工作区化与 4 层接线

- 日期：2026-07-03
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

当前插件只有长期记忆开关解析与 runtime gate，没有真正的长期记忆正文存储、generated recall 或运行时 prompt 注入。用户要求参考目标系统的四层记忆设计，但仅实现长期记忆能力；同时新增兼容规则：如果目标工作区已存在 `.ch` 目录，则认为该项目已有自带记忆体系，插件侧长期记忆即使开关为开也要自动失效。

## 目标

实现插件侧长期记忆的首个可用闭环：

1. 以当前工作区 `.sinitek_cli/memory/` 作为长期记忆正文目录。
2. 按 `Working / Episodic / Semantic / Procedural` 的四层模型建立热区文件骨架。
3. 基于热区文件生成最小 generated recall 产物，并在任务执行前注入补充提示词。
4. 在任务成功结束后把本轮摘要写回工作区长期记忆。
5. 长期记忆总开关继续遵循“显式 false 防误开优先”，并新增 `.ch` 存在时自动关闭的共享 gate。

## 范围

- `src/memory/` 新增工作区路径、热区文件、generated recall、prompt 注入相关模块。
- `src/extension.ts` 接入长期记忆 runtime gate、prompt 注入、成功后摘要落盘、`.ch` 自动关闭兼容。
- `src/webview/viewContent.ts`、`src/webview/types.ts` 增加长期记忆被 `.ch` 接管时的状态展示。
- 原历史验证证据见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)。
- 关联文档交付已同步。

## 非目标

- 不实现完整的 claim registry、memory eval、reference pack。
- 不改 `AGENTS.md`、`.ch/docs/` 作为长期记忆使用入口。
- 不实现复杂的 AI 驱动自动语义归纳；首版以受控模板化摘要和 recall 为主。

## 验收标准

- [x] 插件能在当前工作区 `.sinitek_cli/memory/` 建立四层记忆热区文件和 `generated/` 目录。
- [x] 发送 prompt 前，如长期记忆启用且工作区无 `.ch`，会生成 recall pack 并注入补充提示词。
- [x] 任务成功结束后，能把本轮摘要追加到工作区长期记忆文件。
- [x] 若工作区存在 `.ch` 目录，则长期记忆运行时自动关闭；UI 能展示关闭原因；即使工作区开关为开也不得 recall / inject / 写入。
- [x] `npm run build` 通过；测试细节与原始结果见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)。

## 影响面

- 代码目录：`src/extension.ts`、`src/memory/`、`src/webview/`、`src/test/`
- 文档目录：`docs/long_term_memory_design.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/cli-reference.md`、`docs/插件功能清单.md`
- 配置与脚本：无新增外部依赖；沿用 `npm run build` 与 `node --test`

## 风险与缓解

- 风险：长期记忆目录与现有 `~/.sinitek_cli/` 口径冲突。
- 缓解：只迁移长期记忆正文到工作区；其它历史/设置继续保留原路径，并同步文档说明边界。

- 风险：自动摘要过于噪音，污染长期记忆。
- 缓解：首版只写入受控模板字段，限制摘要长度，并优先写入 `ROLLING_SUMMARY.md` / `EVENT_MEMORY.md`。

- 风险：`.ch` 自动关闭只做 UI，不做共享 gate，可能出现隐藏写入。
- 缓解：统一走 `runtimeGate.ts`，所有 recall / inject / 写入前都校验。

## 验证计划

- 最小相关验证：长期记忆路径、gate、recall、prompt 注入、摘要落盘单测。
- 单元自测命令：`npm run build`；`node --test dist/test/toolSettings.test.js dist/test/memoryRuntimeGate.test.js dist/test/longTermMemory.test.js`
- 扩展验证：静态复核 `src/extension.ts` 发送入口、结束落盘入口和 webview 状态回传链路。

## 测试与清单同步

- 历史测试验证证据、命令和真实结果由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)记录；文档交付及同步项由关联 docs 计划记录。

## 任务列表

- [x] 新增长期记忆工作区路径、热区文件、generated recall、prompt 注入模块。
- [x] 在 `extension.ts` 接入长期记忆 recall / inject / 成功后摘要落盘与 `.ch` 自动关闭 gate。
- [x] 更新 webview 状态与提示文案。
- [x] 执行构建；单测由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)记录。

## 决策记录

- 2026-07-03：长期记忆正文只落工作区 `.sinitek_cli/memory/`，不继续使用 `~/.sinitek_cli/memory/` 作为主事实来源。
- 2026-07-03：如工作区存在 `.ch` 目录，则视为项目已有记忆体系，插件侧长期记忆运行时自动关闭；不强制改写用户保存的 workspace 开关值。
- 2026-07-03：运行时使用补充提示词注入，不修改项目规则文件。

## 当前结论

已完成。当前插件已新增 `src/memory/` 模块，按工作区 `.sinitek_cli/memory/` 建立四层热区文件和 `generated/` 召回产物；发送 prompt 前会按相关性生成 recall pack 并注入补充提示词，任务成功结束后会把本轮摘要写回长期记忆。共享 runtime gate 现已纳入 `.ch` 自动关闭兼容，UI 会展示该关闭原因。原始验证证据见删除审计，文档计划仍只记录文档交付。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
