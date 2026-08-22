# 移除 Loop 自动睡眠与定时唤醒

- 日期：2026-08-22
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-22
- claim_ttl：本轮任务
- handoff_to：

## 背景

用户明确要求去掉“已进入自动睡眠等待定时唤醒”功能。该能力属于 Loop 多代理运行时的自动睡眠/定时恢复协议，与 Graph 节点的 sleeping / auto wake 能力不同。

## 目标

移除 Loop 自动睡眠与定时唤醒的运行时调度、协议字段、面板展示、测试期望和产品文档描述，确保 Loop 仍保留人工继续执行与子任务完成后的常规复核。

## 范围

覆盖 Loop prompt builder、运行时决策解析、任务状态归一化、面板状态与渲染、相关单元测试、产品规格与设计文档。

## 非目标

不移除 Graph `sleeping` 状态、Graph auto wake 能力、Loop 手动继续执行、Loop 子任务完成后的主任务复核。

## 验收标准

- [x] 代码中不再存在 Loop 自动睡眠/定时唤醒的主动协议与 UI。
- [x] 历史 `sleeping` Loop 记录有兼容归一化路径且不恢复自动唤醒。
- [x] 相关构建与最小相关单元测试通过。
- [x] 产品规格、设计文档和 ontology 校验完成。

## 影响面

- 代码目录：`src/extension.ts`、`src/extensionHost/`、`src/webview/`、Loop 状态与 prompt 相关模块。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`、`docs/`。
- 配置与脚本：`package.json` 测试入口可能随删除测试同步。

## 风险与缓解

- 风险：误删 Graph sleeping / auto wake 或 Loop 人工继续执行能力。
- 缓解：残留搜索时区分 Loop 与 Graph 语义，验证相关 Loop 和面板测试。

## 验证计划

- 最小相关验证：残留关键词检索。
- 单元自测命令：`npm run build`；`node --test dist/test/loopTaskStoreCoreCoverage.test.js dist/test/loopDebate.test.js dist/test/loopPromptBuilders.test.js dist/test/loopDebatePanel.test.js dist/test/extensionDeactivateStopAll.test.js dist/test/loopMainDecisionParsing.test.js dist/test/extensionHostExtractionContracts.test.js dist/test/panelDiagnostics.test.js`
- 扩展验证：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`

## 测试与清单同步

- 单元测试新增/更新：已更新 Loop 状态归一化、Prompt Builder、面板渲染、运行时契约和停用清理相关测试。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/loopTaskStoreCoreCoverage.test.js dist/test/loopDebate.test.js dist/test/loopPromptBuilders.test.js dist/test/loopDebatePanel.test.js dist/test/extensionDeactivateStopAll.test.js dist/test/loopMainDecisionParsing.test.js dist/test/extensionHostExtractionContracts.test.js dist/test/panelDiagnostics.test.js` 通过，82/82。
- 失败处理记录：首次面板测试失败来自旧断言误扫脚本内 `stopTask` handler 与人工构造的 `canStop`/`canContinue` 同时为 true；已收窄断言并恢复面板按钮互斥守卫后重跑通过。
- 功能清单：已同步 removed 条目。
- 相关文档同步：已同步产品规格、设计文档和兼容入口文档；残留搜索仅剩 removed 文档说明和兼容测试。

## 任务列表

- [x] 移除 Loop 自动睡眠/定时唤醒运行时与 UI。
- [x] 更新相关测试和文档描述。
- [x] 搜索残留引用并修正意外残留。
- [x] 运行构建、测试和 ontology 校验。
- [x] 归档执行计划。

## 决策记录

- 2026-08-22：只移除 Loop 自动睡眠/定时唤醒；保留 Graph sleeping / auto wake 和 Loop 人工继续执行。

## 当前结论

Loop 自动睡眠/定时唤醒已移除并验证通过；Graph sleeping / auto wake 与 Loop 人工继续执行保留。
