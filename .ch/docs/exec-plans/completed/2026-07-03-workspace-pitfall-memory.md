# 工作区长期记忆踩坑记录迁移

- 日期：2026-07-03
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-03T09:43:36Z
- claim_ttl：PT2H
- handoff_to：-

## 背景

插件侧长期记忆已经按当前工作区 `.sinitek_cli/memory/` 建立四层热区文件、generated recall 和 prompt 注入链路。用户要求继续参考目标系统 `/Users/fangjiawei/sinitek/sinitek_codex_harness/app`，迁移一个“踩坑记录”能力。

目标系统的稳定口径是：真实踩坑不留在聊天记录里；仍有行动价值的条目进入 `runbooks/PITFALLS.md`；历史复盘进入 `PITFALLS_HISTORY.md`；每条必须写清楚“现象、触发条件、根因、长期规避、验证方式、关联资料”。插件侧不应改目标项目规则文件，应复用已有运行时补充提示词和 workspace-local `.sinitek_cli/memory/` 存储。

## 目标

- 在插件侧长期记忆中新增 workspace-local `PITFALLS.md` 热区文件。
- 自动从失败、阻塞、回滚、踩坑等任务总结中沉淀结构化踩坑条目。
- 让踩坑条目进入 generated recall 与 prompt 注入，作为后续任务的可召回上下文。
- 保持长期记忆开关、显式 false 防误开、`.ch` 自动关闭、禁写规则不变。

## 范围

- `src/memory/` 热区定义、索引、召回优先级、prompt label、自动沉淀逻辑。
- 相关单元测试。
- 长期记忆设计、运行时参考、能力清单文档。

## 非目标

- 不新增独立数据库、向量库或 JSONL 主存储。
- 不修改目标项目 `.ch` 规则文件。
- 不做完整手动编辑/归档 UI。
- 不迁移目标系统完整 runbooks 分片体系。

## 验收标准

- [x] 新工作区 scaffold 会创建 `.sinitek_cli/memory/PITFALLS.md`，README 明确用途。
- [x] `PITFALLS.md` 会被 index / recall / prompt injection 覆盖，且中英文标签可用。
- [x] 含失败、阻塞、回滚、踩坑等信号的运行总结会写入结构化踩坑条目，并刷新 generated artifacts。
- [x] 关闭长期记忆或项目存在 `.ch` 时不新增/更新踩坑记忆。
- [x] 单元测试覆盖 scaffold、recall、自动沉淀；`npm run build` 与相关 node tests 通过。
- [x] 产品规格、运行时参考和长期记忆设计文档同步。

## 影响面

- 代码目录：`src/memory/`、`src/test/`
- 文档目录：`docs/`、`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/exec-plans/`
- 配置与脚本：无

## 风险与缓解

- 风险：自动沉淀把普通错误或临时失败写成长期踩坑。
- 缓解：只在响应包含明显失败/阻塞/回滚/踩坑/根因/规避/验证等信号时写入；首版不从每次错误 stderr 原样写入。

- 风险：与项目 `.ch` 记忆体系重叠。
- 缓解：沿用现有 shared runtime gate；`.ch` 存在时插件侧长期记忆整体自动关闭。

- 风险：结构化字段为空时产生低质量模板。
- 缓解：自动条目以“本轮观察/推断/后续补充”为边界，避免伪造根因；后续可加手动确认 UI。

## 验证计划

- 最小相关验证：`node --test dist/test/memoryRuntimeGate.test.js dist/test/longTermMemory.test.js`
- 单元自测命令：`npm run build`
- 扩展验证：检查 generated recall 文件包含 `PITFALLS.md` 来源。

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/longTermMemory.test.ts`，覆盖 `PITFALLS.md` scaffold、recall 注入和结构化坑点写入。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/toolSettings.test.js dist/test/memoryRuntimeGate.test.js dist/test/longTermMemory.test.js` 通过（15/15）。
- 失败处理记录：无失败。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `docs/LONG_TERM_MEMORY_DESIGN.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/cli-reference.md`、`docs/插件功能清单.md`、`docs/vscode_cli_plugin_dev_guide.md`。

## 任务列表

- [x] 读取目标系统 PITFALLS 规则与当前长期记忆实现。
- [x] 增加 `PITFALLS.md` 热区文件定义、README 和 prompt label。
- [x] 实现自动踩坑检测与结构化条目写入。
- [x] 更新测试与文档。
- [x] 运行构建和相关单测。
- [x] 归档执行计划。

## 决策记录

- 2026-07-03：踩坑记录作为 procedural long-term memory 热区加入 `.sinitek_cli/memory/PITFALLS.md`，不写入目标项目 `.ch/docs/runbooks/PITFALLS.md`。

## 当前结论

已完成。插件侧长期记忆现在会在当前工作区 `.sinitek_cli/memory/PITFALLS.md` 记录结构化踩坑条目，并通过 generated recall 与 prompt 注入影响后续任务；该能力继续受长期记忆总开关和 `.ch` 自动关闭 gate 约束。
