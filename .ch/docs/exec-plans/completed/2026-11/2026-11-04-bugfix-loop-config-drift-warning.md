# Loop / Loop+ 配置忙碌修复降级为警告

- 日期：2026-11-04
- 状态：completed
- 类型：bugfix
- 负责人：Codex

> 本文仅保留中间方案及其验证记录，不代表当前行为。用户后续收窄为“只检查档案切换，连接信息不比较”；最终方案见 [仅检查档案身份的执行边界](2026-11-04-feature-model-selection-config-boundary.md)。最终实现已移除原生内容比对、自动修复及漂移警告，而非继续沿用下述警告降级逻辑。

## 背景与目标

原生配置与已选档案不一致且同一 CLI 已有执行租约时，写保护抛出的错误经统一入口中断 Loop / Loop+。本次仅将这一场景降级为中文警告，让循环继续执行，不在任务运行期间修复配置。

## 范围与非目标

- 范围：配置服务的忙碌修复结果、统一执行入口的 Loop 警告展示；不承接回归开发，历史测试摘要见关联删除审计，事实来源写作原指向已退役 docs companion（完整记录未恢复）。
- 非目标：不放开配置切换或当前档案保存/删除，不忽略所见版本过期、档案摘要变化、读取/写入/预检等其它失败，不改变普通对话行为，不修改用户真实配置。

## 验收标准

- Loop / Loop+ 主任务和子任务遇到忙碌配置漂移时继续派发，显示明确中文警告。
- 降级期间原生配置和认证文件不被改写，继续运行的请求仍持有并释放执行租约。
- 全部租约释放后，下次执行恢复正常校验与修复。
- 普通对话及其它配置错误保持既有拒绝行为。

## 影响面与风险

- 代码：`src/config/configService.ts`、`src/extension.ts`。
- 测试：`src/test/config/configService.test.ts`、`src/test/extensionHost/promptSessionHealth.test.ts`。
- 文档：功能清单、CLI 运行时参考、配置协调 ontology 规则。
- 风险：警告续跑期间不能保证外部改变的原生配置与档案一致；提示用户所有任务结束后重新应用。不吞普通错误，保留跨窗口版本检查和互斥写保护。

## 关联计划

- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-loop-config-drift-warning.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
- 历史文档分工：原 docs companion `2026-11-04-docs-loop-config-drift-warning.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。本计划保留中间实现及决策，不把关联交付并入实现范围。[references 索引](../../../references/index.md)仅作导航。

## 验证计划

- `npm run build`。
- 最小回归：配置服务和统一执行入口相关 Node 测试。
- 扩展验证：配置协调、原生配置校验、Loop / Loop+ 集成相关测试。
- 使用临时 HOME 下的真实文件和执行租约验证漂移、只读续跑、阻止切换、释放及空闲修复；不访问真实凭据、不发送模型请求。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与 `git diff --check`。

## 任务列表

Tasklist:
- [completed] 定位配置异常与循环中断链路
- [completed] 实现有边界的警告续跑
- [completed] 完成构建并记录中间方案边界

## 决策记录

- 2026-11-04：用专属错误类型识别“已有执行租约，无法修复原生配置”；只有带 Loop 任务 ID 的执行显式允许降级。警告通过租约结果传回统一入口，保留租约生命周期和原有错误边界。
- 2026-11-04：当前工作区直接交付修复；仅为核对全量失败，在系统临时目录创建 detached HEAD 基线 worktree，不创建分支，核对后已移除。

## 测试与清单同步

- 单元测试新增/更新：配置服务覆盖配置/认证两类漂移、无漂移、只读不写、跨模块租约保留、并发续跑、释放后修复和过期版本拒绝；统一入口覆盖七种 CLI × 三种执行路由 × 主/子任务的警告续跑、普通请求保持拒绝、其它配置错误以及续跑后运行失败释放租约。
- 构建：`npm run build` 通过。
- 最小回归先红后绿：修改统一入口前，新增续跑用例出现原始“暂不能修复配置”异常，另两项边界用例通过；修复后首轮相关测试 91 项全部通过。
- 扩展回归：`node --test dist/test/config/configService.test.js dist/test/extensionHost/promptSessionHealth.test.js dist/test/config/sharedRuntimeConfig.test.js dist/test/config/runtimeConfigVerification.test.js dist/test/config/cliruntimeconfigstrategies.test.js dist/test/config/currentConfigOwnership.test.js dist/test/config/configApplyQueue.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/loopModelRouting.test.js`，244 项全部通过，无跳过。
- 全量：`node scripts/run_unit_tests.js`，2755 项中通过 2748、失败 4、跳过 3。
- 失败分类：既有测试夹具问题，不属于本次修改；`loopPlusModeEntry` 两项及 `looppluswebviewintegration` 一项缺少 `readVisibleConfigSelections`，`runPromptHistoryWebview` 一项缺少 `vscode`。在基线提交 `f9a4fe5` 的独立临时 worktree 构建后执行 `node --test dist/test/webview/loopPlusModeEntry.test.js dist/test/webview/looppluswebviewintegration.test.js dist/test/webview/runPromptHistoryWebview.test.js`，24 项中同样失败 4 项，错误及用例一致，未修复范围外问题。
- 本机状态验证：配置服务测试实际使用临时 HOME 下的原生配置、认证文件和共享租约文件；配置/认证漂移后警告续跑、文件不变、租约有效且空闲后修复。未修改真实用户配置；未在 Extension Development Host 中运行真实供应商 Loop，也未发送模型请求。
- 结构校验：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与 `git diff --check` 通过。
- 功能清单及 ontology：已同步 `FEATURE_INVENTORY.md`、CLI 运行时参考和配置协调规则。架构分层不变，无需修改 `ARCHITECTURE.md`。
- 长期记忆：稳定行为写入运行时参考与 ontology，不重复扩写热区记忆。

## 当前结论

已完成。CodeGraph 提供入口与影响范围导航；直接读取当前源代码确认并修复 `guardedRuntimeWrite` 经 `runPrompt` 中断派发的链路，且核对经典 Loop 和 Loop+ 均传递 `loopTaskId`。只针对忙碌原生配置修复降级为警告，其它失败及跨窗口写保护不变。全量未通过项均有未修改基线复现证据；没有本次范围内未决问题。
