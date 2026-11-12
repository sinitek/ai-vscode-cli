# Codex Loop 角色模型与思考力度传递：事实文档

- 日期：2026-07-29
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-29
- claim_ttl：本轮会话
- handoff_to：无
- 类型：docs

## 关联计划

- [feature：功能实现与兼容边界](./2026-07-29-feature-codex-loop-role-thinking.md)：同源历史任务；文档以该功能的实际行为为事实来源，不承担功能实现。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

以上记录按原计划的实际交付拆分，日期、完成状态与各项验证限制沿用历史记录；下列历史命令及结果不是2026-11-11重新执行的证明。

## 背景与目标

同步Codex普通/Loop角色模型与思考力度的产品和运行时事实，保留OpenCode既有语义。

## 范围与非目标

- `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`docs/插件功能清单.md`。
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`。
- 角色力度按active config+role+model保存，普通Coding保持单模型；不承担角色回归测试。

## 验收标准

- [x] 功能清单与能力规格同步Codex主/子模型和思考力度。
- [x] 运行时参考与设计保留OpenCode原有语义及子任务上限。

## 影响面

- `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`docs/插件功能清单.md`。
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`。
- 角色力度按active config+role+model保存，普通Coding保持单模型；不承担角色回归测试。

## 风险与缓解

仅继承本源已记载的交付与证据；不把构建/单测通过扩展成真实CLI、浏览器或真机通过。跨计划出现失败时保留原归因，不为迁移补跑历史命令或改写历史结论。

## 验证计划与历史结果

历史验收依据为原源“测试与清单同步”的文档完成记录；原文未记载独立文档校验命令或逐文档结果，不补造。

- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `docs/插件功能清单.md`。
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`；现有 OpenCode 相关文档变更保持既有事实来源口径。

## 测试与清单同步

本计划不新增测试代码；验证复用删除审计留存的历史证据，不建立新的通过声明。
文档写作承担原源的清单/事实来源同步；本轮只迁移计划，不再次修改功能清单或运行时。

## 任务列表与当前结论

- [x] 完成范围内原文已确认的事实来源写作与清单同步。
- [x] 保留文档适用边界，不把实现自动化结果称为人工/真机验收。

状态completed继承原记录的完成口径；未执行与范围外失败仍按上面的具体说明保留。本分区中央映射已同步删除 test 目标；本分区 test 计划已按授权删除，外部引用仍待后续集成；未删除实际测试代码。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
