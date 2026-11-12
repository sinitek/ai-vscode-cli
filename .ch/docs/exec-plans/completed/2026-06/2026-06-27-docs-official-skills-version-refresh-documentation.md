# 官方 skills 版本刷新与最新判断修复——文档同步

- 日期：2026-06-27
- 状态：completed
- 负责人：Codex / 人类 / 协作
- 类型：docs
- 迁移来源：`.ch/docs/exec-plans/completed/2026-06/2026-06-27-official-skills-version-refresh.md`

## 关联计划

- [feature：官方 skills 逐条版本字段与展示](2026-06-27-feature-official-skills-version-records.md)
- [bugfix：官方 skills 最新状态判定修复](2026-06-27-bugfix-official-skills-latest-detection.md)
- [chore：官方 skills 归档刷新与下架清理](2026-06-27-chore-official-skills-refresh-cleanup.md)
- 历史测试证据：[删除审计](../../migrations/test-plan-removals/2026-11-11-apr-jun.json)（entries[4]；test 类型计划已删除，独立测试开发不并入本计划交付范围）。

## 迁移说明

2026-11-11 按实际工作类型拆分。日期、负责人及状态沿用原文；下列命令和结果均为历史记录，本次迁移不执行历史命令，也不新增验收结论。

## 独立目标与实施范围

同步版本字段、contentHash比较、上游核验、Gemini历史与清理边界的事实来源、清单及相关说明；不承接运行时代码或测试开发。

## 独立验收与证据边界

文档反映原计划日期时的承诺、决策与验证边界；下方保留原有勾选与“需要/已同步”措辞，不把计划要求擅自提升为逐页验收通过。

实际结果以本文件下方分配的原始记录为准；未单独记录的结果仍未验证。整组构建/测试的历史证据见关联实现计划，不自动当作本工作包的独立验收。

## 目标

4. 完成文档同步，确保后续维护者可以重复执行同一刷新流程。

## 范围

- 同步相关事实来源文档。

## 验收标准

- [x] 功能清单与事实来源文档已同步，验证结果可复核。

## 影响面

- 文档目录：
  - `.ch/docs/exec-plans/`
  - `.ch/docs/references/`
  - `.ch/docs/product-specs/`
  - `docs/`

## 风险与缓解

- 同步文档，配合关联 chore 显式处理新增、删除、重命名清单，不做隐式覆盖。

## 测试与清单同步

- 功能清单：
  - 若官方 skills 管理行为、版本展示或更新判断发生变化，同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 与相关能力规格。
- 相关文档同步：
  - `.ch/docs/references/authoritative-skills.md`
  - 相关 CLI / 插件能力文档入口
  - 必要时补充 runbook 或 PITFALLS，记录版本字段与上游核验注意事项

## 任务列表

- [x] 阶段 6：文档与清单同步。
  - 同步功能清单、事实来源文档与相关说明。
- 同步 runbook、能力规格和功能清单，

## 当前结论

当前已完成文档同步。
5. 事实来源文档与功能清单已同步，明确记录版本展示、`contentHash` 判断规则和 `firebase` canonical 来源。
2026-08-03 收尾归档：本计划已有实现、验证和文档同步记录；按 active plan 清理要求归档到 `completed/`，
