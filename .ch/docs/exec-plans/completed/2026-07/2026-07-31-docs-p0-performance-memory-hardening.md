# P0 性能与内存硬化执行计划：事实文档

- 日期：2026-07-31
- 状态：completed
- 负责人：Loop 协作
- owner：msg_1785460421595_9a96966a875c9 / p0-exec-plan-inventory
- claimed_at：2026-07-31
- claim_ttl：本轮 P0 全部验收前
- handoff_to：`.ch/docs/exec-plans/completed/2026-07/2026-07-31-perf-p0-performance-memory-hardening.md`
- 类型：docs

## 关联计划

- [perf：P0性能/内存硬化实现](./2026-07-31-perf-p0-performance-memory-hardening.md)：同源历史任务；文档以六项P0实现矩阵为事实来源，不承担优化实现。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

以上记录按原计划的实际交付拆分，日期、完成状态与各项验证限制沿用历史记录；下列历史命令及结果不是2026-11-11重新执行的证明。

## 背景与目标

完成P0审计回写、运行时/CLI/产品规格与功能清单同步，保存计划矩阵、子任务协作和后续P1/P2范围，不冒称实现代码。

## 范围与非目标

- `docs/PERFORMANCE_MEMORY_AUDIT_2026-07-13.md`最终结论；runtime design、CLI reference、产品规格、FEATURE_INVENTORY与归档记录。
- 原`p0-exec-plan-inventory`仅写计划/报告：保留owner、claim及handoff，不声称该子任务改产品代码。
- 原`p0-final-validation-docs`承担独占验证汇总与审计/规格同步，验证命令为历史证据。
- 不改generated recall/memory index、不写优化或测试代码。

## 验收标准

- [x] stop/deactivate、输出有界、流式渲染、附件限制写入规格与清单。
- [x] 最终结论回写原审计和运行时事实；后续P1/P2另起，不把generated提升事实来源。
- [x] 保留动态压测/真机量化的后续性质，文档完成不等于该项已执行。

## 影响面

- `docs/PERFORMANCE_MEMORY_AUDIT_2026-07-13.md`最终结论；runtime design、CLI reference、产品规格、FEATURE_INVENTORY与归档记录。
- 原`p0-exec-plan-inventory`仅写计划/报告：保留owner、claim及handoff，不声称该子任务改产品代码。
- 原`p0-final-validation-docs`承担独占验证汇总与审计/规格同步，验证命令为历史证据。
- 不改generated recall/memory index、不写优化或测试代码。

## 风险与缓解

仅继承本源已记载的交付与证据；不把构建/单测通过扩展成真实CLI、浏览器或真机通过。跨计划出现失败时保留原归因，不为迁移补跑历史命令或改写历史结论。

## 验证计划与历史结果

历史`p0-final-validation-docs`完成记录确认审计、runtime design、CLI reference、产品规格和清单均已同步；`git diff --check` exit 0。原完整验证114/114见删除审计，不代表新增人工/动态压测证据。

- 功能清单：附件数量/单文件/总量限制、stop/deactivate 行为、OpenCode 输出有界和流式渲染硬化已同步到产品规格与功能清单。
- 相关文档同步：最终结论已写回审计报告、runtime design、CLI reference、产品规格和本归档计划；未修改 generated recall / memory index。

## 测试与清单同步

本计划不新增测试代码；验证复用删除审计留存的历史证据，不建立新的通过声明。
文档写作承担原源的清单/事实来源同步；本轮只迁移计划，不再次修改功能清单或运行时。

## 任务列表与当前结论

- [x] 完成范围内原文已确认的事实来源写作与清单同步。
- [x] 保留文档适用边界，不把实现自动化结果称为人工/真机验收。

状态completed继承原记录的完成口径；未执行与范围外失败仍按上面的具体说明保留。本分区中央映射已同步删除 test 目标；本分区 test 计划已按授权删除，外部引用仍待后续集成；未删除实际测试代码。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
