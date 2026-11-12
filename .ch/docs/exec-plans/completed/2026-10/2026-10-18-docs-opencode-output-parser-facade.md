# OpenCode 输出解析外观拆分 — 文档

- 日期：2026-10-18
- 状态：completed
- 负责人：协作
- owner：Loop attempt round-2-opencode-output-parser-refactor
- claimed_at：2026-10-18
- claim_ttl：本次尝试
- handoff_to：无
- 类型：docs

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-18-opencode-output-parser-facade.md`（历史标识，原文件已替换）
- 关联计划：[行为保持重构](2026-10-18-refactor-opencode-output-parser-facade.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

只承担“OpenCode 输出解析外观拆分”原文明确的文档/规格、架构事实、runbook 与 ontology 同步，不补写原文未交付的说明。

## 本子计划实施范围

下列归属条目中的事实来源与文档同步；实现代码由关联存活计划承担；独立测试开发不属本计划，原 test 计划已删除，历史事实见删除审计。

## 本子计划验收

文档描述与关联实现/决策一致；原文声明无需修改、受阻、待审或引用失效的事项仍保持原结论。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-18-refactor-opencode-output-parser-facade.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本类型交付的实际验证以[同源原任务验证与边界](2026-10-18-refactor-opencode-output-parser-facade.md#历史验证与未决事项)及下列原文局部记录为准。此引用复用当时构建/定向测试/文档校验等证据，不表示单独重跑或新增通过结论；未覆盖和历史失败同样适用。

## 原文归属记录

## 范围

- 更新 `ARCHITECTURE.md` 的 CLI 服务层短段。

## 影响面

- 文档目录：`ARCHITECTURE.md`、本计划。

## 验证计划

- ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。

## 测试与清单同步

- 功能清单：用户可见行为、文案、UI、国际化和持久化 schema 未由本次拆分改变。

- 相关文档同步：`ARCHITECTURE.md` CLI 服务层增加 Facade、纯解析模块、export 副作用归属。

## 任务列表

- 文档与归档

## 决策记录

- 2026-10-18：ontology `plugin.local_cli` 的 source_refs 指向 CLI 运行参考和 Grok 交互实现。

## 最终验证

5. `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：validation passed，domains=2 concepts=17 relations=16 rules=43 workflows=2 documents=3。

## 当前结论

纯解析模块与进程 Facade 已分离，公开符号和 recover 行为由新测试与既有 facade、消费方测试锁定。完成计划只保留本归档。实施期间仓库出现与本次无关的并发工作区改动，包括 package.nls 内联、Webview 和若干文档；本次没有回滚或继续修改它们。`ARCHITECTURE.md` 除本次 CLI 段落外，目录树里 `i18n.ts` 注释也被该并发改动更新，已按“其他改动原样保留”留下。
