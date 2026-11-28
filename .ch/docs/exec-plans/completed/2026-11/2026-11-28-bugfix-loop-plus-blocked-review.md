# Loop+ 自主处理可恢复阻塞

- 日期：2026-11-28
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-28
- claim_ttl：本轮任务结束
- handoff_to：无

## 背景与目标

一次普通澄清超时后，主任务将缺少原实施路径的历史凭据作为全局暂停依据。后续沟通找到了在原交付范围内重建并验证的办法。目标是由主任务主动找出这样的替代方案，并在全部未完成要求确实无法推进时交代具体限制。

## 范围与交付

- 主任务复核每项前置条件的来源，优先在现有授权内自行选择、派发和验证可逆方案。子任务汇报实际约束和可尝试的替代路径。
- 宿主将最多三个恢复方案保存在 `loopPlusBlockReview` 中，交还主任务执行。复核中新出现的可执行建议能取得一次决策机会，反复提议使用既有协议纠正预算。
- 普通表单超时只记录无人作答。迟到用户消息先交给主任务，表单额度用尽后仍可按已有要求调度。
- 落地暂停前提升可运行工作，等待仍有进展可能的 attempt。迟到报告与验收结果唤醒主任务，保留验收批次的编号和顺序。
- 最终业务阻塞需要 `constraintSource` 和完整诊断。中文摘要说明哪项交付因何受阻、证据、尝试及恢复条件或替代方案。

## 验收与验证

- [x] 合成回归从普通澄清超时、旧回执缺失，经过主任务自行派发本地重建，到两套预览的模拟回报和正式验收，最终进入 `completed`。
- [x] 覆盖首次及复核阶段提出恢复方案、重复方案、缺少阻塞依据、真实外部限制、迟到消息与报告、冻结批次、可启动工作及在途完成。发布权限与用户明确拒绝仍按既有流程处理。
- [x] `npm run build` 通过。对 `dist/test/extensionHost`、`dist/test/loop` 和 `dist/test/core` 中匹配 `*loopPlus*`、`*loopplus*`、`*loopBlock*`、`loopTaskS*` 和 `*orchestratorClarification` 的测试文件运行 `node --test --test-concurrency=3`。944 项通过，失败、取消和跳过均为 0。
- [x] `node scripts/loop_plus_protocol_regression_smoke.cjs --fixture-only` 的 9 个确定性场景通过。`node scripts/loop_plus_protocol_regression_smoke.cjs --scenario=success-baseline-extension-host --extension-host-only` 在 macOS arm64 的隔离 VS Code 宿主通过，使用临时工作区及合成 CLI。
- [x] `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与 `git diff --check` 通过。

回归中发现，冻结验收后的报告交接会多唤醒一次主任务。修正为报告消费完后依当前验收队列决定是否需要唤醒，重新执行相关套件通过。

## 影响面与风险

涉及主任务决策与提示、子任务汇报提示、复核状态的归一化、决策 helper、澄清与中文摘要。旧记录可按缺省字段读取。宿主校验诊断字段及队列状态，主模型负责核实所引用事实，交付仍按原验收要求验证。对替代路径的权限判断以实际操作为准，本地重建与生产发布各自按其所需权限处理。

## 事实来源与验证边界

行为记录于 `.ch/docs/design-docs/loop-plus-scheduling.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 及运行时 ontology 的阻塞复核、熔断说明和恢复方案规则。原任务只作定向只读诊断。真实扩展宿主覆盖合成成功基线，预览及阻塞分支由确定性调度回归验证。
