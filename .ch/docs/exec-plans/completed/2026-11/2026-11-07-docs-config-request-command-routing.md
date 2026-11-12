# 配置中心请求命令路由重构执行计划 — 文档与事实源交付

- 日期：2026-11-07
- 状态：completed（领域与面板接线、构建/回归、文档及 ontology 校验全部完成）
- 类型：docs
- 负责人：Loop+ 协作；第 3 轮交付领域模块/设计，第 4 轮单一 coding attempt 负责中央接线及收口
- handoff_to：主任务最终复核；当前无接口竞争或待确认问题
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-07-config-request-command-routing.md`

## 目标与范围

配置请求设计、ARCHITECTURE导航与五个ontology来源。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- [2026-11-07-refactor-config-request-command-routing.md](2026-11-07-refactor-config-request-command-routing.md)：承接产品实现及其决策/约束。
- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。

## 验收标准

- 完成以下实际文档交付：配置请求设计、ARCHITECTURE导航与五个ontology来源；记录与实现、测试证据一致，不把文档门禁当作功能或真实环境验收。
- 原第3轮仅设计、第4轮才完成接线；保留扩展原状态、39/39复用基线、213与433历史结果及类型负向探针。

## 验证与真实状态

验证计划：复用原文档/ontology/引用/空白检查记录；没有原文成功证据的检查不补造。原计划记录的 ontology 校验及范围空白/差异检查通过；独立测试开发已移除，其审计保留的历史测试摘要、结果与边界见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-07-config-request-command-routing.md）。功能/页面行为历史验证按关联计划中的存活实现记录追溯；本 docs 计划及删除审计均不构成现行 test 验证入口。本次不重新执行。

原状态：completed（领域与面板接线、构建/回归、文档及 ontology 校验全部完成）。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 来源头部说明

- 设计契约：[配置中心请求命令分发设计](../../../design-docs/config-center-request-commands.md)。

### 范围

- 第 4 轮修改：`src/webview/configPanel.ts`、新增 `src/webview/configRequestRouter.ts` 和 `src/test/config/configRequestRouter.test.ts`，扩展 `src/test/config/cliPageConfigCoverage.test.ts`；同步设计、架构导航、本计划和必要 ontology 来源。

### 验收标准

- [x] 核对局部文档规则、execution-plan/ontology skill、计划 README/TEMPLATE、架构、产品事实、协议与当前分发实现。
- [x] 记录 12 + 7 + 5 的独立交付边界与行为不变量，明确设计/并行交付不等于已集成。
- [x] 最终接线后复核架构与 ontology 实际来源路径，必要时更新；完成全部验收后才标记 completed 并归档。

### 影响面

- 文档目录：`.ch/docs/design-docs/config-center-request-commands.md`、`ARCHITECTURE.md`、本计划及 `.ch/docs/ontology/domains/cli-plugin-runtime.json` 的 source_refs。
- 外部报告：第 4 轮仅更新指定 `round-4-config-command-integration.md`，不修改第 3 轮报告。

### 第 3 轮文档验证（历史记录，非接线验证）

- ontology status/关键词查询与 `plugin.config_profile` 的 21 个 `source_refs` 路径核对；相关两个锚点检查。
- `python3 /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/.agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 domains / 16 concepts / 15 relations / 108 rules / 2 workflows。
- `node scripts/check_trailing_whitespace.js .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/active/2026-11-07-config-request-command-routing.md`：通过，退出码 0，无尾随空白。
- 使用本地 `markdown-it` 的 Node stdin 只读校验：通过两文档的单一 H1、标题层级、换行与表格检查；2 个相对链接及 27 处现有来源路径有效，12 + 7 + 5 表格与 24 个 `CONFIG_ACTIONS` 无重复且集合相等；计划保持进行中、集成门槛未勾选。拟建模块按设计态排除，不冒充已存在来源。
- `git -C /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli diff --check -- .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/active/2026-11-07-config-request-command-routing.md`：退出码 0；两文件是新增未跟踪文档，实际内容由上述空白与 Markdown 检查覆盖。

### 第 4 轮类型与文档校验

- `python3 /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/.agents/skills/ontology/scripts/search_ontology.py --validate`：退出码 0，2 domains / 16 concepts / 15 relations / 108 rules / 2 workflows，新增五处实际 source_refs 不改变语义。日志 `ontology.log`。
- `node /tmp/sinitek-command-integration.kJfNDh/check-docs.cjs .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/active/2026-11-07-config-request-command-routing.md`：归档前退出码 0；两文档 H1/标题层级/末尾换行、2 个相对链接、24 个无重复动作与 CONFIG_ACTIONS 一致、26 个配置档案 source_refs 及锚点全部有效。日志 `docs.log`。归档后以 completed 路径再次校验链接。
- `node scripts/check_trailing_whitespace.js src/webview/configPanel.ts src/webview/configRequestRouter.ts src/test/config/configRequestRouter.test.ts src/test/config/cliPageConfigCoverage.test.ts ARCHITECTURE.md .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/active/2026-11-07-config-request-command-routing.md .ch/docs/ontology/domains/cli-plugin-runtime.json`：退出码 0。
- `git -C /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli diff --check -- <上述改动路径>`：退出码 0；新增未跟踪文件还由实际编译/测试/空白脚本检查，不以 diff --check 替代内容验证。
- 归档后实际运行 `node /tmp/sinitek-command-integration.kJfNDh/check-docs.cjs .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/completed/2026-11/2026-11-07-config-request-command-routing.md`：退出码 0，2 个相对链接、24 个动作和 26 个 source_refs 再次通过；日志 `docs-archived.log`。以 completed 路径再次执行上述空白检查和 diff --check，均为 0；设计/架构/ontology 中已无指向旧 active 计划的引用。

### 测试与清单同步

- 功能清单：`FEATURE_INVENTORY.md` 无需改动，本次是内部行为保持重构，不改变用户功能、权限、流程或承诺。
- 相关文档同步：更新设计为实际生产依赖与新增动作流程，ARCHITECTURE 增加导航；ontology 仅为 `plugin.config_profile` 增加五个实际来源，不改业务概念、关系、规则或状态。不制造热区记忆或自动摘要。

### 任务列表

- [x] 写明已确定的两模块接口、24 键组成与行为保持契约。

### 决策记录

- 2026-11-07（第 3 轮）：仅完成设计与计划，领域模块并行交付；未提前宣称集成完成或归档。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。原第3轮仅设计、第4轮才完成接线；保留扩展原状态、39/39复用基线、213与433历史结果及类型负向探针。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
