# 对话标签切换恢复执行配置与模型 — 文档

- 日期：2026-10-22
- 状态：completed
- 负责人：Codex
- 类型：docs

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-22-conversation-tab-model-restore.md`（历史标识，原文件已替换）
- 关联计划：[新功能开发](2026-10-22-feature-conversation-tab-model-restore.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

只承担“对话标签切换恢复执行配置与模型”原文明确的文档/规格、架构事实、runbook 与 ontology 同步，不补写原文未交付的说明。

## 本子计划实施范围

下列归属条目中的事实来源与文档同步；实现代码由关联存活计划承担；独立测试开发不属本计划，原 test 计划已删除，历史事实见删除审计。

## 本子计划验收

文档描述与关联实现/决策一致；原文声明无需修改、受阻、待审或引用失效的事项仍保持原结论。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-22-feature-conversation-tab-model-restore.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本类型交付的实际验证以[同源原任务验证与边界](2026-10-22-feature-conversation-tab-model-restore.md#历史验证与未决事项)及下列原文局部记录为准。此引用复用当时构建/定向测试/文档校验等证据，不表示单独重跑或新增通过结论；未覆盖和历史失败同样适用。

## 原文归属记录

## 影响面与风险

- 文档：功能清单、运行时说明和 ontology。

## 验证计划

- 执行 ontology 校验与脚本单测、差异空白校验。

## 测试与清单同步

- 功能清单与 ontology：已同步功能总表、能力规格、CLI 运行时说明与 ontology 新规则；架构边界未改变。

- 记忆判断：浏览器验证发现的旧配置反写根因沉淀到 `PITFALLS.md`，稳定语义进入 ontology。

### 实际验证命令

```sh
npm run build
node --test --test-reporter=tap dist/test/session/conversationTabConfiguration.test.js dist/test/session/loopPlusSessionTabs.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionStoreCoreCoverage.test.js dist/test/session/loopAskConversationContext.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/extensionHost/openCodePromptRunTemplate.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/opencoderolemodelruntime.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/extensionHost/opencodethinkingrefreshstate.test.js dist/test/config/configApplyQueue.test.js dist/test/webview/openCodeThinkingWebview.test.js dist/test/webview/opencodedualmodelwebview.test.js
node --test --test-reporter=tap --test-name-pattern='profile|tab restored' dist/test/webview/clipagescriptruntimecoverage.test.js
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'
git diff --check
```

## 任务列表

- 同步文档
