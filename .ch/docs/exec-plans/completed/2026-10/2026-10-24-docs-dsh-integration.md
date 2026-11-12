# DeepSeek Harness 接入 — 文档

- 日期：2026-10-24
- 状态：completed
- 负责人：协作
- owner：round-13-dsh-documentation-closeout-sync
- claimed_at：2026-10-24T11:44:20Z
- claim_ttl：收尾已完成
- handoff_to：
- 类型：docs

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-24-dsh-integration.md`（历史标识，原文件已替换）
- 关联计划：[新功能开发](2026-10-24-feature-dsh-integration.md); [维护/构建/发布治理](2026-10-24-chore-dsh-local-installation.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

只承担“DeepSeek Harness 接入”原文明确的文档/规格、架构事实、runbook 与 ontology 同步，不补写原文未交付的说明。

## 本子计划实施范围

下列归属条目中的事实来源与文档同步；实现代码由关联存活计划承担；独立测试开发不属本计划，原 test 计划已删除，历史事实见删除审计。

## 本子计划验收

文档描述与关联实现/决策一致；原文声明无需修改、受阻、待审或引用失效的事项仍保持原结论。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。chore 的官方安装版本与 docs 的上游/provider 契约是 feature 接入核对的输入；最终能力文档以实现和实际验证边界为准。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-24-feature-dsh-integration.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本类型交付的实际验证以[同源原任务验证与边界](2026-10-24-feature-dsh-integration.md#历史验证与未决事项)及下列原文局部记录为准。此引用复用当时构建/定向测试/文档校验等证据，不表示单独重跑或新增通过结论；未覆盖和历史失败同样适用。

## 原文归属记录

## 背景

- 官方推荐通道 `latest` 是发布候选 `@deepseek-ai/dsh@0.2.1-rc.2`，不是稳定版。`next` 的 `0.2.1-rc.3` 未安装。2026-10-24 的实现和文档收尾已经完成。本计划从 `active/` 归档到 `completed/2026-10/`。

## 目标

2. 以安装版本的文档、类型和真实进程探针写成程序化契约。

## 范围

- ontology、用户可见说明和本计划收尾。

## 影响面

- 文档目录：本计划、`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`、`docs/cli-reference.md`、`docs/插件功能清单.md`、`package.json`。

## 验证计划

- 收尾文档校验：`npm run build`、`npm run validate:whitespace`、`git diff --check`。

## 测试与清单同步

- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。

- 相关文档同步：参考索引、两份 DSH 契约、ontology、CLI 参考、插件功能清单和 `package.json` 用户可见描述已按当前事实更新。

## 任务列表

- [x] 同步文档并把本计划归档。

## 当前结论

安装、契约、配置页、ACP runner、Skills 根、规则链和最终模型插件实跑已经完成。命令顺序是 `codex`、`claude`、`opencode`、`grok`、`dsh`。Skills 目标是五个，顺序保持 Claude、OpenCode、Grok、Codex、DSH。未配置模型不能执行。缺失 usage 不显示为 0。adapter-fallback 不是服务容量。原生 compaction 明确不支持。真实权限请求和图形 Extension Host 点击验收未验证，不得虚报。本计划收尾时，配置页的 provider、模型 id 和 `apiKeyEnv` 仍为只读，只有 `baseURL` 可编辑。后续配置页轮次已落地 JSON/可视化双模式和有序多模型编辑，当前事实以产品规格和 `.ch/docs/references/dsh-custom-provider-contract.md` 为准。本计划已完成并归档。
