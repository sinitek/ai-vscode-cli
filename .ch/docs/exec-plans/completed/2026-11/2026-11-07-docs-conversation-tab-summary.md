# 对话 Tab 任务摘要 — 文档与事实源交付

- 日期：2026-11-07
- 状态：completed
- 类型：docs
- 负责人：运行时、前端、文档三个独立交付边界协作
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-07-conversation-tab-summary.md`

## 目标与范围

功能清单、能力规格、运行时设计与五项ontology由proposed到active。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- [2026-11-07-feature-conversation-tab-summary.md](2026-11-07-feature-conversation-tab-summary.md)：承接产品实现及其决策/约束。
- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。

## 验收标准

- 完成以下实际文档交付：功能清单、能力规格、运行时设计与五项ontology由proposed到active；记录与实现、测试证据一致，不把文档门禁当作功能或真实环境验收。
- 首次新增能力；E1/E2/E4覆盖有重叠，281/18/299/41不求和；E3历史真实Codex、其余六CLI未真实联调及早期失败保留。

## 验证与真实状态

验证计划：复用原文档/ontology/引用/空白检查记录；没有原文成功证据的检查不补造。原计划记录的 ontology 校验及范围空白/差异检查通过；独立测试开发已移除，其审计保留的历史测试摘要、结果与边界见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-07-conversation-tab-summary.md）。功能/页面行为历史验证按关联计划中的存活实现记录追溯；本 docs 计划及删除审计均不构成现行 test 验证入口。本次不重新执行。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 三个独立交付边界

| 边界 | 主要范围 | 交接与验收证据 |
| --- | --- | --- |
| 运行时与数据 | 首次任务提交接入；复用已有 CLI/provider 配置的独立受限 session；`src/sessionTabs.ts`、`src/sessionStore.ts`、`src/sessionLifecycle.ts`、`src/extensionHost/sessionTabs.ts` 的摘要保存、映射及失效处理 | 输出可选 `taskSummary`；提供触发次数、失败不阻塞、迁移/恢复、迟到结果与协议隔离证据 |
| 前端与交互 | 消费可选字段；`src/webview/types.ts`、`src/webview/viewContentScript/messageRendering.ts` 及必要主题样式/事件处理 | 字段契约与运行时协调，不竞争重写；提供计时、隐藏、键盘、安全文本及窄屏证据 |
| 文档与本体 | 本计划、功能总表、能力分册、运行时设计、`cli-plugin-runtime` ontology | 只登记目标与验收，不将计划测试写成通过；文档检查通过不代表功能验收 |

### 影响面与事实来源

- 文档：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`。

### 测试与清单同步

- 初始文档阶段：功能以 in-progress、5 条新 ontology 记录以 proposed 登记；当时只有文档检查通过，不能代表实现完成。
- 初始文档校验：ontology `--validate` 首次发现新增关系缺少 `cardinality`，补为 `1:0..1` 后通过（2 domains / 17 concepts / 16 relations / 111 rules / 2 workflows）；五份文档空白/diff/13 个新增引用检查通过。当时未运行功能测试/真实 CLI/浏览器，作为历史阶段保留，不是最终状态。
- 最终同步：功能清单与能力分册改为 active，设计改为实际实现，5 条对应 ontology 记录改为 schema 认可的 active 并补齐真实源码/测试 source_refs；本计划置 completed 并归档到月份目录，仓库内旧活动路径引用同步迁移。
- 收口文档检查（2026-11-07）：ontology `--validate` 通过（2 domains / 17 concepts / 16 relations / 111 rules / 2 workflows）；五份文档空白/diff 检查通过，18 个仓库路径引用和 5 条 active 记录的 31 个 source_refs/已有锚点检查通过，旧活动计划文件及路径引用均无残留。具体命令与最终结果写入本轮指定执行报告，不重跑 E1–E4。

### 任务列表

- [x] 核对文档规则、ontology status/query 和现有源码入口。
- [x] 交付执行计划、用户行为规格、运行时设计及 ontology 更新并验证。
- [x] 收集运行时实现与相关单元/真实 CLI 验证。（E1/E3，保留六 CLI 未真实联调限制）
- [x] 收集前端实现与自动/浏览器验收证据。（E2/E4，非完整 VS Code 端到端）
- [x] 依据主审及原始材料逐项回填验收，标记 completed 并按月份归档；保留未验证限制。

### 决策记录与当前结论

- 2026-11-07 初始阶段：文档/本体交付完成，但实现与真实验证尚待收集，保持活动状态而不提前归档。
- 2026-11-07 最终阶段：读取父任务最新 communicationFile，复核运行时/UI/文档三份交付报告、当前源码、主审 299/299 日志、真实 Codex 与浏览器原始材料后完成收口。范围内功能已交付；六 CLI 真实 provider、完整扩展宿主端到端、确定性繁简转换和无关全量测试未验证，不列为已完成证据。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。首次新增能力；E1/E2/E4覆盖有重叠，281/18/299/41不求和；E3历史真实Codex、其余六CLI未真实联调及早期失败保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
